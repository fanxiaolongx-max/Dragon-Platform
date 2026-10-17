(function () {
    'use strict';

    // Global CanvasRenderingContext2D guard against 0-dimension pattern crashes (html2canvas compatibility)
    (function installCanvasGuard() {
        if (typeof CanvasRenderingContext2D === 'undefined') return;
        if (CanvasRenderingContext2D.prototype._eosPatternGuarded) return;
        const origCreatePattern = CanvasRenderingContext2D.prototype.createPattern;
        CanvasRenderingContext2D.prototype.createPattern = function (image, repetition) {
            if (!image) {
                return origCreatePattern.apply(this, arguments);
            }
            const w = image.width !== undefined ? image.width : (image.naturalWidth !== undefined ? image.naturalWidth : 0);
            const h = image.height !== undefined ? image.height : (image.naturalHeight !== undefined ? image.naturalHeight : 0);
            if (w <= 0 || h <= 0) {
                const dummy = (this.canvas?.ownerDocument || document).createElement('canvas');
                dummy.width = 1;
                dummy.height = 1;
                return origCreatePattern.call(this, dummy, repetition || 'repeat');
            }
            return origCreatePattern.apply(this, arguments);
        };
        CanvasRenderingContext2D.prototype._eosPatternGuarded = true;
    })();

    const metric = (key, label, unit, description, decimals = 0) => ({ key, label, unit, description, decimals });
    const TOPICS = {
        'netcare-certificate': {
            label: 'NetCare · 证书风险', platform: 'netcare', path: 'certificate',
            metrics: [metric('total', '需消减', '个', '当期证书风险中需要消减的网元数'), metric('reduced', '已消减', '个', '已完成证书风险消减的网元数'), metric('pending', '待消减', '个', '需消减减去已消减'), metric('completionRate', '完成率', '%', '已消减 ÷ 需消减', 1)]
        },
        'netcare-eos-product': {
            label: 'NetCare · EOS 产品收编', platform: 'netcare', path: 'eosProduct',
            metrics: [metric('quantity', '总量', '个', '紧急 EOS 产品纳入收编口径的总量'), metric('incorporated', '已收编', '个', '已完成收编的产品数'), metric('pending', '待收编', '个', '源数据中待收编数量'), metric('annualPlan', '今年计划', '个', '用户录入且不超过待收编量的计划数'), metric('noPlan', '无计划', '个', '待收编减去今年计划'), metric('currentRate', '当前收编率', '%', '已收编 ÷ 总量', 1), metric('plannedRate', '计划后收编率', '%', '（已收编+今年计划）÷ 总量', 1)]
        },
        'netcare-eos-version': {
            label: 'NetCare · EOS 版本收编', platform: 'netcare', path: 'eosVersion',
            metrics: [metric('quantity', '总量', '个', '高风险 EOS 版本纳入收编口径的总量'), metric('incorporated', '已收编', '个', '已完成收编的版本数'), metric('pending', '待收编', '个', '源数据中待收编数量'), metric('annualPlan', '今年计划', '个', '用户录入且不超过待收编量的计划数'), metric('noPlan', '无计划', '个', '待收编减去今年计划'), metric('currentRate', '当前收编率', '%', '已收编 ÷ 总量', 1), metric('plannedRate', '计划后收编率', '%', '（已收编+今年计划）÷ 总量', 1)]
        },
        'netcare-change': {
            label: 'NetCare · 变更数量', platform: 'netcare', path: 'change',
            metrics: [metric('taskCount', '本年累计变更', '次', '截至快照月份的 TOTAL 变更任务数'), metric('priorTaskCount', '上年同期', '次', '上年相同月份范围内的 TOTAL 变更任务数'), metric('yoyRate', '同比变化', '%', '（本年累计-上年同期）÷ 上年同期', 1), metric('operationSuccessRate', '操作成功率', '%', '按任务数加权的本年累计操作成功率', 1), metric('rollbackCount', '回退数', '次', '本年累计回退数'), metric('highRiskCount', '高危核心', '次', '本年累计高危核心操作数')]
        },
        'netcare-interception': {
            label: 'NetCare · 高危拦截', platform: 'netcare', path: 'interception',
            metrics: [metric('total', '本年累计拦截', '次', '截至快照月份的 TOTAL 高危拦截数'), metric('priorTotal', '上年同期', '次', '上年相同月份范围的 TOTAL 拦截数'), metric('yoyRate', '同比变化', '%', '（本年累计-上年同期）÷ 上年同期', 1), metric('commandCount', '命令行拦截', '次', '本年累计命令行拦截数'), metric('graphicalCount', '图形化拦截', '次', '本年累计图形化拦截数')]
        },
        'netcare-sr': {
            label: 'NetCare · SR 问题单', platform: 'netcare', path: 'sr',
            metrics: [metric('total', '本年累计 SR', '单', '当年年初至快照月份的 TOTAL SR 数'), metric('priorTotal', '上年同期', '单', '上年相同时间范围的 TOTAL SR 数'), metric('yoyRate', '同比变化', '%', '（本年累计-上年同期）÷ 上年同期', 1), metric('frtRate', 'FRT', '%', '本年累计 SR FRT 达成率', 1), metric('openCount', '未关闭', '单', '本年累计口径中的未关闭 SR'), metric('overdueCount', '逾期', '单', '本年累计口径中的逾期 SR'), metric('majorCount', 'Major', '单', '本年累计 Major SR'), metric('criticalCount', 'Critical', '单', '本年累计 Critical SR')]
        },
        'datafab-return': {
            label: 'DataFab · 日志回传', platform: 'datafab', path: 'return',
            metrics: [metric('returnRate', '日志回传率', '%', '已回传 ÷ 需回传操作量', 1), metric('required', '需回传', '笔', '所选范围与剔除规则下的需回传操作量'), metric('returned', '已回传', '笔', '已完成日志回传的操作量'), metric('pending', '待回传', '笔', '需回传减去已回传'), metric('targetRate', '回传目标', '%', '快照导出时配置的回传率目标', 1)]
        },
        'datafab-filing': {
            label: 'DataFab · 日志备案', platform: 'datafab', path: 'filing',
            metrics: [metric('recordRate', '日志备案率', '%', '备案量 ÷ 需回传操作量', 1), metric('recorded', '备案量', '笔', '有备案原因的操作数'), metric('required', '需回传', '笔', '备案率所使用的分母'), metric('limitRate', '备案上限', '%', '快照导出时配置的备案率上限', 1), metric('rawRows', '原始明细', '条', '快照中保存的全部月度原始明细行数')]
        }
    };

    const state = { items: [], total: 0, topicKey: 'netcare-eos-product', metricKey: 'pending', detailRows: [], detailColumns: [], detailPage: 1, detailPageSize: 50, detailSortColumn: '', detailSortAscending: true, detailFilter: '', eosMonthlyReport: null, eosMonthlySnapshot: null, fixedCopyDefaults: new Map(), copyDefaults: new Map(), isImportedProject: false, importedProjectMeta: null, isAiConnected: false, aiSettings: null };
    const elements = {};
    const monthlyEngine = window.TopicMonthlyEngine;
    state.monthlyTopicKey = 'eos';
    let monthlyLoadVersion = 0;
    const monthlySessions = new Map();
    let monthlyBusy = 0;
    const isGenericMonthly = () => state.monthlyTopicKey !== 'eos';
    const monthlyDefinition = () => monthlyEngine.get(state.monthlyTopicKey);
    const monthlyFilename = () => monthlyDefinition().filename;

    function genericStorageKey(kind, scope, month = state.eosMonthlyReport?.month) {
        let tenant = 'default';
        try { tenant = localStorage.getItem('tools_tenant_id') || tenant; } catch (_) {}
        return monthlyEngine.storageKey(state.monthlyTopicKey, kind, tenant, scope, month);
    }

    async function monthlyTask(action) {
        monthlyBusy++;
        const controls = [document.getElementById('monthlyTopic'), elements.eosMonthlyMonth, elements.refreshButton];
        controls.forEach(control => { if (control) control.disabled = true; });
        try { return await action(); }
        finally {
            monthlyBusy--;
            if (!monthlyBusy) controls.forEach(control => { if (control) control.disabled = false; });
        }
    }

    function configureMonthlyTopic(key) {
        state.monthlyTopicKey = key;
        const definition = monthlyDefinition();
        document.getElementById('monthlyTopic').value = key;
        document.getElementById('eosMonthlyTitle').textContent = definition.title;
        document.querySelector('#eosMonthlyTitle + p').textContent = key === 'eos'
            ? '每月采用该数据月份最后导入的一份 NetCare 快照；计划数和目标沿用该快照保存的设置。'
            : `每月采用该专题数据月份最后导入的一份 ${definition.platform === 'netcare' ? 'NetCare' : 'DataFab'} 快照；统计与目标沿用历史快照。`;
        document.querySelectorAll('.topic-fixed-progress').forEach(node => { node.hidden = key !== 'eos'; });
        elements.eosCopyResetFixed.hidden = key !== 'eos';
        elements.eosConfigBtn.hidden = key !== 'eos';
        elements.eosMonthlyMonth.setAttribute('aria-label', '月报月份');
        const hint = document.querySelector('.topic-monthly-edit-hint').firstChild;
        if (!state.eosEditHint) state.eosEditHint = hint.textContent;
        hint.textContent = key === 'eos' ? state.eosEditHint : '点击月报文字或表格可修改；选中文字可加粗或改色。当前浏览器按专题、租户和月份保存编辑；跨设备可导出工程继续编辑。';
    }

    async function switchMonthlyTopic(key, load = true) {
        if (!monthlyEngine.get(key)) return;
        if (monthlyBusy) { document.getElementById('monthlyTopic').value = state.monthlyTopicKey; return; }
        if (document.activeElement?.classList?.contains('topic-editable')) document.activeElement.blur();
        hideTextToolbar(); hideDiffPopover(true); closePngDropdown();
        monthlyLoadVersion++;
        monthlySessions.set(state.monthlyTopicKey, {
            report: state.eosMonthlyReport, snapshot: state.eosMonthlySnapshot,
            imported: state.isImportedProject, meta: state.importedProjectMeta,
            source: elements.eosMonthlySource.innerHTML, months: elements.eosMonthlyMonth.innerHTML,
            defaults: state.copyDefaults
        });
        configureMonthlyTopic(key);
        const cached = monthlySessions.get(key);
        state.copyDefaults = cached?.defaults || new Map();
        state.eosMonthlyReport = cached?.report || null;
        state.eosMonthlySnapshot = cached?.snapshot || null;
        state.isImportedProject = cached?.imported || false;
        state.importedProjectMeta = cached?.meta || null;
        elements.eosMonthlyMonth.innerHTML = cached?.months || '';
        elements.eosMonthlySource.innerHTML = cached?.source || '';
        setCopyStatus('');
        if (!load) return;
        if (cached?.report) {
            elements.eosMonthlyMonth.value = cached.report.month;
            setMonthlyEnabled(true);
            renderEosMonthlyReport(cached.report); renderEosMonthlyReportEn(cached.report);
            if (!isGenericMonthly()) updateFixedTablesCustomerNames();
            updateBilingualSyncStatus();
        } else await loadMonthlyReport();
    }

    function setMonthlyEnabled(enabled) {
        ['eosCopyResetMonth', 'eosDownloadPng', 'eosDownloadPdf', 'eosDownloadHtml', 'eosDownloadExcel', 'eosDownloadMsg', 'eosExportProjectBtn', 'eosSaveSnapshotBtn', 'eosManageSnapshotsBtn', 'eosDiffBtn'].forEach(key => { if (elements[key]) elements[key].disabled = !enabled; });
    }

    function renderGenericMonthly(report, language) {
        const root = language === 'en' ? elements.eosMonthlyReportEn : elements.eosMonthlyReport;
        const tr = value => value && typeof value === 'object' ? String(value[language] ?? value.zh ?? '') : String(value ?? '');
        const cell = (row, col) => row[col.key] === null || row[col.key] === undefined ? '—' : col.unit ? monthlyEngine.fmt(row[col.key], col.unit) : typeof row[col.key] === 'number' ? monthlyEngine.fmt(row[col.key]) : tr(row[col.key]);
        root.innerHTML = `<h3 class="topic-report-title">${escapeHtml(language === 'en' ? monthlyDefinition().en : monthlyDefinition().title)} (${escapeHtml(report.month)})</h3>
            <div class="topic-monthly-copy topic-report-overview-copy">${report.overview.map(item => `<p>${escapeHtml(tr(item))}</p>`).join('')}</div>
            ${report.sections.map(item => `<section class="topic-monthly-section"><h3 class="topic-report-item-title">${escapeHtml(tr(item))}</h3><div class="topic-table-wrap"><table class="topic-monthly-table" data-monthly-table="${escapeHtml(item.id)}"><thead><tr>${item.columns.map(col => `<th>${escapeHtml(tr(col))}</th>`).join('')}</tr></thead><tbody>${item.rows.map(row => `<tr>${item.columns.map((col, i) => i === 0 ? `<th scope="row">${escapeHtml(cell(row, col))}</th>` : `<td>${escapeHtml(cell(row, col))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${!item.rows.length ? `<p class="topic-monthly-footnote">${language === 'en' ? 'No records available in this snapshot.' : '当前快照暂无该项记录。'}</p>` : ''}</section>`).join('')}
            ${report.notes.map(note => `<p class="topic-monthly-footnote">${escapeHtml(tr(note))}</p>`).join('')}`;
        const scope = language === 'en' ? 'monthly-en' : 'monthly';
        activateCopy(root, MONTHLY_COPY_SELECTOR, scope);
        root.querySelectorAll('[data-monthly-table]').forEach(table => activateTableCells(table, table.dataset.monthlyTable, scope));
        updateBilingualSyncStatus();
    }

    async function loadGenericMonthlyReport(month, requestVersion) {
        const key = state.monthlyTopicKey;
        state.eosMonthlyReport = null; state.eosMonthlySnapshot = null;
        setMonthlyEnabled(false);
        elements.eosMonthlySource.textContent = '';
        try {
            const result = await API.get(`/api/topic-snapshots/monthly-report?topic=${encodeURIComponent(key)}${month ? `&month=${encodeURIComponent(month)}` : ''}`);
            if (requestVersion !== monthlyLoadVersion) return;
            elements.eosMonthlyMonth.innerHTML = (result.months || []).map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
            if (month && !(result.months || []).includes(month)) elements.eosMonthlyMonth.add(new Option(month, month));
            if (month || result.report?.month) elements.eosMonthlyMonth.value = month || result.report.month;
            if (!result.report) {
                elements.eosMonthlyReport.textContent = '该月份暂无此专题数据。请导入包含该专题的快照，或选择其他月份。';
                elements.eosMonthlyReportEn.textContent = 'No data for this topic and month. Import a snapshot or select another month.';
                updateBilingualSyncStatus(); return;
            }
            state.eosMonthlyReport = result.report;
            const source = result.report.snapshot;
            elements.eosMonthlySource.textContent = `数据月份 ${result.report.month} · 数据时间 ${formatTime(source.capturedAt)} · 导入时间 ${formatTime(source.importedAt)}${source.name ? ` · ${source.name}` : ''}`;
            setMonthlyEnabled(true);
            renderEosMonthlyReport(result.report); renderEosMonthlyReportEn(result.report);
        } catch (error) {
            if (requestVersion !== monthlyLoadVersion) return;
            elements.eosMonthlyReport.textContent = `月报读取失败：${error.message}。请点击“刷新数据”重试。`;
            elements.eosMonthlyReportEn.textContent = 'Unable to load this report. Please refresh to retry.';
            updateBilingualSyncStatus();
        }
    }

    function appendGenericWorksheets(workbook, report) {
        for (const [index, data] of report.detailSheets.entries()) {
            const worksheet = workbook.addWorksheet(`${index + 1}-${data.name}`.replace(/[\\/*?:\[\]]/g, '').slice(0, 31));
            const keys = [...new Set(data.rows.flatMap(row => Object.keys(row)))];
            worksheet.addRow(keys);
            data.rows.forEach(row => worksheet.addRow(keys.map(key => typeof row[key] === 'object' && row[key] !== null ? JSON.stringify(row[key]) : row[key] ?? '')));
            worksheet.getRow(1).font = { bold: true };
            worksheet.views = [{ state: 'frozen', ySplit: 1 }];
            keys.forEach((key, i) => { worksheet.getColumn(i + 1).width = 22; });
            if (keys.length) worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: keys.length } };
        }
    }
    const DETAIL_LABELS = { customer_name: '客户', product_line_name: '产品线', product_line_map: '产品线', product_name: '产品', software_version: '版本', task_id: '任务单号', need_reduce_cnt: '需消减', reduced_cnt: '已消减', incorporation_total_nes: '数量', incorporated_nes: '已收编', to_be_incorporated_nes: '待收编', current_phase_name: '阶段', scope: '范围', year: '年份', month: '月份', task_count: '变更任务数', operation_success_rate: '操作成功率', rollback_count: '回退数', high_core_total_count: '高危核心', interception_cnt: '拦截数', commands_interception_cnt: '命令行拦截', graphical_interception_cnt: '图形化拦截', period: '期间', sr_total: 'SR 数', sr_frt: 'FRT', unclose_sr_cnt: '未关闭', overdue_sr_cnt: '逾期', minor_sr_cnt: 'Minor', major_sr_cnt: 'Major', critical_sr_cnt: 'Critical' };
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const formatTime = value => { const date = new Date(value || ''); return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString('zh-CN', { hour12: false }); };
    const topic = () => TOPICS[state.topicKey];
    const selectedMetric = () => topic().metrics.find(item => item.key === state.metricKey) || topic().metrics[0];
    const topicData = item => item?.summary?.topics?.[topic().path];
    const topicItems = () => state.items.filter(item => item.platform === topic().platform && topicData(item)).sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)));
    const metricValue = (item, definition = selectedMetric()) => Number(topicData(item)?.[definition.key]);

    function formatMetric(value, definition) {
        if (!Number.isFinite(Number(value))) return '--';
        return `${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: definition.decimals, maximumFractionDigits: definition.decimals })}${definition.unit || ''}`;
    }

    function renderTopicControls() {
        const groups = { netcare: [], datafab: [] };
        Object.entries(TOPICS).forEach(([key, item]) => groups[item.platform].push(`<option value="${key}"${key === state.topicKey ? ' selected' : ''}>${escapeHtml(item.label.replace(/^\w+\s·\s/, ''))}</option>`));
        elements.topicFilter.innerHTML = `<optgroup label="NetCare">${groups.netcare.join('')}</optgroup><optgroup label="DataFab">${groups.datafab.join('')}</optgroup>`;
        elements.metricFilter.innerHTML = topic().metrics.map(item => `<option value="${item.key}"${item.key === state.metricKey ? ' selected' : ''}>${escapeHtml(item.label)}</option>`).join('');
    }

    function updateStats() {
        elements.totalCount.textContent = state.total;
        elements.netcareCount.textContent = state.items.filter(item => item.platform === 'netcare').length;
        elements.datafabCount.textContent = state.items.filter(item => item.platform === 'datafab').length;
        const latest = state.items[0]; elements.latestTime.textContent = latest ? formatTime(latest.capturedAt) : '--';
    }

    function renderKpis() {
        const items = topicItems(); const latest = items[0]; const previous = items[1];
        elements.analysisTitle.textContent = topic().label; elements.metricDefinition.textContent = selectedMetric().description;
        elements.topicKpis.innerHTML = topic().metrics.map(definition => {
            const value = metricValue(latest, definition); const prior = metricValue(previous, definition); const delta = value - prior;
            const comparison = Number.isFinite(prior) ? `较上次 ${delta > 0 ? '+' : ''}${formatMetric(delta, definition)}` : '暂无上一份快照';
            const tone = Number.isFinite(prior) ? (delta > 0 ? 'positive' : delta < 0 ? 'negative' : '') : '';
            return `<article><span>${escapeHtml(definition.label)}</span><strong>${escapeHtml(formatMetric(value, definition))}</strong><small class="${tone}">${escapeHtml(comparison)}</small></article>`;
        }).join('');
    }

    function renderChart() {
        const items = topicItems().slice().reverse(); const definition = selectedMetric();
        const plotted = items.map(item => ({ item, value: metricValue(item, definition) })).filter(point => Number.isFinite(point.value));
        if (!plotted.length) { elements.trendChart.innerHTML = '<div class="topic-chart-empty">该专题还没有可用的历史快照</div>'; return; }
        const width = 1100; const height = 260; const pad = { left: 62, right: 24, top: 24, bottom: 42 };
        const values = plotted.map(point => point.value); let min = Math.min(0, ...values); let max = Math.max(0, ...values); if (min === max) max += 1;
        const x = index => pad.left + (plotted.length === 1 ? (width - pad.left - pad.right) / 2 : index * (width - pad.left - pad.right) / (plotted.length - 1));
        const y = value => pad.top + (max - value) / (max - min) * (height - pad.top - pad.bottom);
        const points = plotted.map((point, index) => `${x(index)},${y(point.value)}`).join(' ');
        const grid = [0, .25, .5, .75, 1].map(ratio => { const value = min + (max - min) * ratio; const gy = y(value); return `<line x1="${pad.left}" y1="${gy}" x2="${width - pad.right}" y2="${gy}" stroke="#dfe3ed" stroke-dasharray="4 5"/><text x="8" y="${gy + 4}" fill="#8c94a8" font-size="11">${escapeHtml(formatMetric(value, definition))}</text>`; }).join('');
        const dots = plotted.map((point, index) => `<g><circle cx="${x(index)}" cy="${y(point.value)}" r="5" fill="${point.item.platform === 'datafab' ? '#2377e8' : '#6d35f2'}"><title>${escapeHtml(formatTime(point.item.capturedAt))} · ${escapeHtml(formatMetric(point.value, definition))}</title></circle><text x="${x(index)}" y="${height - 16}" text-anchor="middle" fill="#8c94a8" font-size="10">${escapeHtml(String(point.item.capturedAt || '').slice(5, 10))}</text></g>`).join('');
        elements.trendChart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img"><title>${escapeHtml(topic().label)} · ${escapeHtml(definition.label)}</title>${grid}<polyline points="${points}" fill="none" stroke="${topic().platform === 'datafab' ? '#2377e8' : '#6d35f2'}" stroke-width="3" stroke-linejoin="round"/>${dots}</svg>`;
    }

    function renderTable() {
        const items = topicItems(); const definition = selectedMetric(); elements.metricColumnTitle.textContent = definition.label; elements.emptyState.hidden = items.length > 0;
        elements.historyBody.innerHTML = items.map(item => `<tr><td>${escapeHtml(formatTime(item.capturedAt))}</td><td><span class="topic-platform ${escapeHtml(item.platform)}">${item.platform === 'datafab' ? 'DataFab' : 'NetCare'}</span></td><td>${escapeHtml(item.period || '--')}</td><td>${escapeHtml(formatMetric(metricValue(item, definition), definition))}</td><td>${escapeHtml(formatTime(item.importedAt))}</td><td><div class="topic-row-actions"><button data-action="view" data-id="${escapeHtml(item.id)}">详表</button><button data-action="download" data-id="${escapeHtml(item.id)}">下载 JSON</button><button class="danger" data-action="delete" data-id="${escapeHtml(item.id)}">删除</button></div></td></tr>`).join('');
    }

    function detailRows(snapshot) {
        const data = snapshot?.data || {};
        if (topic().platform === 'netcare') {
            const source = data[topic().path];
            if (topic().path === 'sr') return [...(data.sr?.summary || []).map(row => ({ rowType: '汇总', ...row })), ...(data.sr?.monthly || []).map(row => ({ rowType: '月度', ...row }))];
            return Array.isArray(source) ? source : Array.isArray(source?.rows) ? source.rows : [];
        }
        const byMonth = data.detailsByMonth && typeof data.detailsByMonth === 'object' ? data.detailsByMonth : {};
        const rows = Object.entries(byMonth).flatMap(([month, values]) => (Array.isArray(values) ? values : []).map(row => ({ month, ...row })));
        return rows.length ? rows : (Array.isArray(data.detail) ? data.detail : []).map(row => ({ month: snapshot.settings?.month || '', ...row }));
    }

    function detailColumns(rows) {
        const keys = []; rows.forEach(row => Object.keys(row || {}).forEach(key => { if (!keys.includes(key) && !['id'].includes(key)) keys.push(key); }));
        return keys;
    }

    function detailValue(value, key) {
        if (value === null || value === undefined || value === '') return '--';
        if (['operation_success_rate', 'sr_frt'].includes(key)) return `${(Number(value) <= 1 ? Number(value) * 100 : Number(value)).toFixed(1)}%`;
        return typeof value === 'object' ? JSON.stringify(value) : String(value);
    }

    function renderDetailTable() {
        const rows = state.detailRows.filter(row => !state.detailFilter || state.detailColumns.some(key => detailValue(row[key], key).toLowerCase().includes(state.detailFilter)));
        const column = state.detailSortColumn;
        rows.sort((a, b) => { if (!column) return 0; const av = detailValue(a[column], column), bv = detailValue(b[column], column); const an = Number(av.replace(/[% ,]/g, '')), bn = Number(bv.replace(/[% ,]/g, '')); const result = Number.isFinite(an) && Number.isFinite(bn) ? an - bn : av.localeCompare(bv, 'zh-CN'); return state.detailSortAscending ? result : -result; });
        const pageCount = Math.max(1, Math.ceil(rows.length / state.detailPageSize)); state.detailPage = Math.min(pageCount, Math.max(1, state.detailPage)); const start = (state.detailPage - 1) * state.detailPageSize; const pageRows = rows.slice(start, start + state.detailPageSize);
        elements.detailSummary.textContent = `${topic().label} · 共 ${state.detailRows.length} 条明细 · 筛选后 ${rows.length} 条 · 第 ${state.detailPage}/${pageCount} 页`;
        elements.detailTable.innerHTML = state.detailRows.length ? `<table><thead><tr>${state.detailColumns.map(key => `<th>${escapeHtml(DETAIL_LABELS[key] || key)}</th>`).join('')}</tr></thead><tbody>${pageRows.map(row => `<tr>${state.detailColumns.map(key => `<td title="${escapeHtml(detailValue(row[key], key))}">${escapeHtml(detailValue(row[key], key))}</td>`).join('')}</tr>`).join('')}</tbody></table><div class="topic-detail-pager"><button data-detail-page="prev" ${state.detailPage <= 1 ? 'disabled' : ''}>上一页</button><b>${state.detailPage} / ${pageCount}</b><button data-detail-page="next" ${state.detailPage >= pageCount ? 'disabled' : ''}>下一页</button><span>显示 ${rows.length ? start + 1 : 0}–${Math.min(rows.length, start + state.detailPageSize)} / ${rows.length}</span></div>` : '<div class="topic-detail-empty">该专题没有可展示的明细数据</div>';
        elements.detailSortColumn.innerHTML = state.detailColumns.map(key => `<option value="${escapeHtml(key)}" ${key === state.detailSortColumn ? 'selected' : ''}>${escapeHtml(DETAIL_LABELS[key] || key)}</option>`).join('');
        elements.detailJson.hidden = true; elements.detailTable.hidden = false; elements.viewRaw.textContent = '原始 JSON';
    }
    function renderDetail(snapshot) {
        state.detailRows = detailRows(snapshot); state.detailColumns = detailColumns(state.detailRows); state.detailPage = 1; state.detailFilter = ''; state.detailSortColumn = state.detailColumns[0] || ''; state.detailSortAscending = true; elements.detailSearch.value = ''; elements.detailTools.hidden = false; elements.detailSortDirection.textContent = '升序'; renderDetailTable();
        elements.detailModal.hidden = false;
    }

    function downloadDetailTable(snapshot) {
        const rows = detailRows(snapshot); const columns = detailColumns(rows); const csv = [columns.map(key => DETAIL_LABELS[key] || key), ...rows.map(row => columns.map(key => detailValue(row[key], key)))].map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
        const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })); link.download = `${snapshot.platform}_${topic().path}_detail.csv`; link.click(); URL.revokeObjectURL(link.href);
    }

    function renderAnalysis() { renderKpis(); renderChart(); renderTable(); }

    const pct = (val, dec = 1) => `${Number(val || 0).toFixed(dec)}%`;

    const DEFAULT_MAPPINGS = {
        'Etisalat Misr': 'e&',
        'Orange Egypt for Telecommunications': 'Orange',
        'Vodafone Egypt': 'Vodafone',
        'Telecom Egypt': 'TE',
        'NILE ON LINE (NOL)': 'e&'
    };
    const DEFAULT_MIN_THRESHOLD = 10;

    function getMappingStorageKey() {
        let tenant = 'default';
        try { tenant = localStorage.getItem('tools_tenant_id') || tenant; } catch (_) {}
        return `topic-eos:mapping-config:v1:${tenant}`;
    }

    function readMappingConfig() {
        try {
            const rawStr = localStorage.getItem(getMappingStorageKey());
            if (!rawStr) {
                return { minThreshold: DEFAULT_MIN_THRESHOLD, aliases: { ...DEFAULT_MAPPINGS } };
            }
            const raw = JSON.parse(rawStr);
            const thresh = Number(raw?.minThreshold);
            const minThreshold = Number.isFinite(thresh) ? Math.max(0, Math.floor(thresh)) : DEFAULT_MIN_THRESHOLD;
            const aliases = (raw?.aliases && typeof raw.aliases === 'object' && !Array.isArray(raw.aliases))
                ? { ...raw.aliases }
                : { ...DEFAULT_MAPPINGS };
            return { minThreshold, aliases };
        } catch (_) {
            return { minThreshold: DEFAULT_MIN_THRESHOLD, aliases: { ...DEFAULT_MAPPINGS } };
        }
    }

    function saveMappingConfig(config) {
        try {
            localStorage.setItem(getMappingStorageKey(), JSON.stringify(config));
        } catch (_) {}
        if (config && typeof config === 'object') {
            API.put('/api/topic-snapshots/mapping-config', config).catch(err => {
                console.warn('[topic-analysis] 同步映射配置到服务器失败:', err);
            });
        }
    }

    async function syncMappingConfigFromServer() {
        try {
            const res = await API.get('/api/topic-snapshots/mapping-config');
            if (res && res.config && res.config.aliases && typeof res.config.aliases === 'object') {
                localStorage.setItem(getMappingStorageKey(), JSON.stringify(res.config));
                if (elements.eosMappingModal && !elements.eosMappingModal.hidden) {
                    renderMappingTableRows(res.config.aliases);
                    if (elements.eosMinThresholdInput) elements.eosMinThresholdInput.value = res.config.minThreshold;
                }
            }
        } catch (_) {}
    }

    function mapCustomerName(rawName) {
        const trimmed = String(rawName || '').trim();
        if (!trimmed) return '未分类客户';
        const config = readMappingConfig();
        if (config.aliases[trimmed]) return config.aliases[trimmed];
        if (trimmed === 'Orange' && config.aliases['Orange Egypt for Telecommunications']) {
            return config.aliases['Orange Egypt for Telecommunications'];
        }
        if (trimmed === 'TE' && config.aliases['Telecom Egypt']) {
            return config.aliases['Telecom Egypt'];
        }
        if (trimmed === 'Vodafone' && config.aliases['Vodafone Egypt']) {
            return config.aliases['Vodafone Egypt'];
        }
        if (trimmed === 'e&' && config.aliases['Etisalat Misr']) {
            return config.aliases['Etisalat Misr'];
        }
        return trimmed;
    }

    function buildOverviewCopyHtml(report) {
        const prod = report.product;
        const ver = report.version;

        const prodRate = Number(prod.total.currentRate || 0);
        const prodPlanned = Number(prod.total.plannedRate || 0);
        let prodTargetStatus = '已达成年度挑战目标';
        if (prodRate < 30) prodTargetStatus = `距离底线目标仍有差距（差${(30 - prodRate).toFixed(1)}%）`;
        else if (prodRate < 40) prodTargetStatus = '已达成年度底线目标';
        else if (prodRate < 50) prodTargetStatus = '已达成年度目标';

        const prodNoPlanAccounts = (prod.accounts || []).filter(a => (a.noPlan || 0) > 0).sort((a, b) => b.noPlan - a.noPlan);
        const prodCustText = prodNoPlanAccounts.length
            ? `（${prodNoPlanAccounts.slice(0, 2).map(a => `${escapeHtml(mapCustomerName(a.customer))} ${a.noPlan}套`).join('，')}）`
            : '';

        const verRate = Number(ver.total.currentRate || 0);
        const verPlanned = Number(ver.total.plannedRate || 0);
        const verRiskText = verPlanned < 70 ? '年度目标达成风险大' : '年度目标达成态势良好';

        const verPlanAccounts = (ver.accounts || []).filter(a => (a.annualPlan || 0) > 0).sort((a, b) => b.annualPlan - a.annualPlan);
        const verPlanCustSummary = verPlanAccounts.length
            ? verPlanAccounts.map(a => `${escapeHtml(mapCustomerName(a.customer))} ${a.annualPlan}套`).join('、')
            : '各客户暂无明确计划';

        const verNoPlanAccounts = (ver.accounts || []).filter(a => (a.noPlan || 0) > 0).sort((a, b) => b.noPlan - a.noPlan);
        const topNoPlanSlice = verNoPlanAccounts.slice(0, 2);
        const verNoPlanCustSummary = topNoPlanSlice.length
            ? topNoPlanSlice.map(a => `${escapeHtml(mapCustomerName(a.customer))} ${a.noPlan}套`).join('、')
            : '各客户已全部纳入收编计划';

        const urgentCustomerNames = topNoPlanSlice.length
            ? topNoPlanSlice.map(a => escapeHtml(mapCustomerName(a.customer))).join('、')
            : '各';

        return `<div class="topic-monthly-copy topic-report-overview-copy">
            <p><strong>【风险管理】</strong>全量EOS产品风险闭环率100%，全量EOS版本风险闭环率100%，均已达成年度目标</p>
            <p><strong>【退网收编】</strong></p>
            <p>1、重急EOS产品退网收编率${pct(prodRate, 2)}，${prodTargetStatus}，预测年底完成率${pct(prodPlanned, 1)}，但仍有${prod.total.noPlan}套网元暂无退网无计划${prodCustText}，建议系统部继续推进；</p>
            <p>2、高风险EOS版本升级收编率${pct(verRate, 2)}，预测年底完成率${pct(verPlanned, 1)}，${verRiskText}，其中：<br>
            1）已有计划：${verPlanCustSummary}，需按计划年内完成版本升级；<br>
            2）暂无计划：${verNoPlanCustSummary}暂无收编计划，请${urgentCustomerNames}系统部加速客户界面交流，最晚于10月确认收编计划，确保年内完成升级。</p>
        </div>`;
    }

    function buildProductCopyHtml(product) {
        const config = readMappingConfig();
        const minThreshold = config.minThreshold;
        const total = product.total;
        const noPlanAccounts = (product.accounts || []).filter(a => (a.noPlan || 0) > 0).sort((a, b) => b.noPlan - a.noPlan);

        const focusDetails = noPlanAccounts.map(a => {
            const cust = mapCustomerName(a.customer);
            const filteredItems = (a.topNoPlanItems || []).filter(i => (i.noPlan || 0) >= minThreshold);
            if (!filteredItems.length) {
                return (a.noPlan || 0) >= minThreshold ? `${escapeHtml(cust)} ${a.noPlan}套` : '';
            }
            const items = filteredItems.map(i => `${escapeHtml(i.label)} ${i.noPlan}套`).join('/');
            return `${escapeHtml(cust)} ${a.noPlan}套（${items}）`;
        }).filter(Boolean).join('、');

        return `<div class="topic-monthly-copy">
            <p>年度收编基线${total.quantity}套，已完成收编${total.incorporated}套，完成率${pct(total.currentRate, 2)}；待收编${total.pending}套，其中${total.noPlan}套今年暂无计划。</p>
            <p>重点关注：${total.noPlan}套暂无退网计划，建议年内完成客户界面交流，并明确退网计划，其中：${focusDetails || '暂无重点待收编项'}。</p>
        </div>`;
    }

    function buildVersionCopyHtml(version) {
        const config = readMappingConfig();
        const minThreshold = config.minThreshold;
        const total = version.total;
        const planAccounts = (version.accounts || []).filter(a => (a.annualPlan || 0) > 0).sort((a, b) => b.annualPlan - a.annualPlan);
        const noPlanAccounts = (version.accounts || []).filter(a => (a.noPlan || 0) > 0).sort((a, b) => b.noPlan - a.noPlan);

        const planDetails = planAccounts.map(a => {
            const cust = mapCustomerName(a.customer);
            const filteredItems = (a.topPlanItems || []).filter(i => (i.annualPlan || 0) >= minThreshold);
            if (!filteredItems.length) {
                return (a.annualPlan || 0) >= minThreshold ? `${escapeHtml(cust)} ${a.annualPlan}套` : '';
            }
            const items = filteredItems.map(i => `${escapeHtml(i.label)} ${i.annualPlan}套`).join('/');
            return `${escapeHtml(cust)} ${a.annualPlan}套（${items}）`;
        }).filter(Boolean).join('、');

        const topNoPlan = noPlanAccounts.slice(0, 2);
        const hasMoreNoPlan = noPlanAccounts.length > 2 || (topNoPlan[0]?.topNoPlanItems?.length > 2);
        const noPlanDetails = topNoPlan.map(a => {
            const cust = mapCustomerName(a.customer);
            const filteredItems = (a.topNoPlanItems || []).filter(i => (i.noPlan || 0) >= minThreshold);
            if (!filteredItems.length) {
                return (a.noPlan || 0) >= minThreshold ? `${escapeHtml(cust)} ${a.noPlan}套` : '';
            }
            const items = filteredItems.map(i => `${escapeHtml(i.label)} ${i.noPlan}套`).join('/');
            return `${escapeHtml(cust)} ${a.noPlan}套（${items}）`;
        }).filter(Boolean).join('、');

        return `<div class="topic-monthly-copy">
            <p>年度收编基线${total.quantity}套，已完成收编${total.incorporated}套，完成率${pct(total.currentRate, 2)}；待收编${total.pending}套，其中${total.annualPlan}套计划年内完成收编，${total.noPlan}套今年暂无计划。</p>
            <p>重点关注：<br>
            1）已有计划：总计${total.annualPlan}套，需要确保在年内完成升级，其中${planDetails || '暂无计划升级项'}。<br>
            2）暂无计划：总计${total.noPlan}套，其中${noPlanDetails || '暂无无计划项'}${hasMoreNoPlan ? '等' : ''}。</p>
        </div>`;
    }

    function renderMonthlySection(section, label) {
        const { total, accounts } = section;
        const cells = metric => `<td>${metric.quantity}</td><td>${metric.incorporated}</td><td>${pct(metric.currentRate, 1)}</td><td>${metric.pending}</td><td>${metric.annualPlan}</td><td>${metric.noPlan}</td><td>${pct(metric.plannedRate, 1)}</td>`;
        const rows = accounts.map(item => `<tr><th scope="row">${escapeHtml(mapCustomerName(item.customer))}</th>${cells(item)}</tr>`).join('');
        const copyHtml = label === '产品' ? buildProductCopyHtml(section) : buildVersionCopyHtml(section);
        const tableNum = label === '产品' ? 1 : 2;
        const tableId = label === '产品' ? 'prod' : 'ver';

        return `<section class="topic-monthly-section">
            <h3 class="topic-report-item-title">➤ 退网收编进展（重急EOS${label}）：</h3>
            ${copyHtml}
            <div class="topic-table-wrap topic-report-table-wrap">
                <table class="topic-monthly-table" id="eosMonthlyTable_${tableId}" data-table-id="${tableId}">
                    <thead>
                        <tr><th rowspan="3">客户</th><th colspan="7">重急 EOS · ${label}</th></tr>
                        <tr><th rowspan="2">总量</th><th rowspan="2">已收编</th><th rowspan="2">当前收编率</th><th colspan="3">待收编</th><th rowspan="2">计划后收编率</th></tr>
                        <tr><th>小计</th><th>今年计划</th><th>无计划</th></tr>
                    </thead>
                    <tbody>
                        ${rows}
                        <tr class="topic-monthly-total"><th scope="row">合计</th>${cells(total)}</tr>
                    </tbody>
                </table>
            </div>
            <p class="topic-report-caption">（表 ${tableNum}：${label} EOS 收编进展）</p>
        </section>`;
    }

    function buildOverviewCopyHtmlEn(report) {
        const prod = report.product;
        const ver = report.version;

        const prodRate = Number(prod.total.currentRate || 0);
        const prodPlanned = Number(prod.total.plannedRate || 0);
        let prodTargetStatus = 'annual challenge target reached';
        if (prodRate < 30) prodTargetStatus = `gap of ${(30 - prodRate).toFixed(1)}% to bottom-line target`;
        else if (prodRate < 40) prodTargetStatus = 'annual bottom-line target reached';
        else if (prodRate < 50) prodTargetStatus = 'annual target reached';

        const prodNoPlanAccounts = (prod.accounts || []).filter(a => (a.noPlan || 0) > 0).sort((a, b) => b.noPlan - a.noPlan);
        const prodCustText = prodNoPlanAccounts.length
            ? `(${prodNoPlanAccounts.slice(0, 2).map(a => `${escapeHtml(mapCustomerName(a.customer))} ${a.noPlan} sets`).join(', ')})`
            : '';

        const verRate = Number(ver.total.currentRate || 0);
        const verPlanned = Number(ver.total.plannedRate || 0);
        const verRiskText = verPlanned < 70 ? 'high risk in reaching annual target' : 'positive momentum in reaching annual target';

        const verPlanAccounts = (ver.accounts || []).filter(a => (a.annualPlan || 0) > 0).sort((a, b) => b.annualPlan - a.annualPlan);
        const verPlanCustSummary = verPlanAccounts.length
            ? verPlanAccounts.map(a => `${escapeHtml(mapCustomerName(a.customer))} ${a.annualPlan} sets`).join(', ')
            : 'No clear plan from customers currently';

        const verNoPlanAccounts = (ver.accounts || []).filter(a => (a.noPlan || 0) > 0).sort((a, b) => b.noPlan - a.noPlan);
        const topNoPlanSlice = verNoPlanAccounts.slice(0, 2);
        const verNoPlanCustSummary = topNoPlanSlice.length
            ? topNoPlanSlice.map(a => `${escapeHtml(mapCustomerName(a.customer))} ${a.noPlan} sets`).join(', ')
            : 'All customers included in incorporation plans';

        const urgentCustomerNames = topNoPlanSlice.length
            ? topNoPlanSlice.map(a => escapeHtml(mapCustomerName(a.customer))).join(', ')
            : 'system';

        return `<div class="topic-monthly-copy topic-report-overview-copy">
            <p><strong>[Risk Management]</strong> 100% risk closure rate for all EOS products, 100% risk closure rate for all EOS versions, both reaching annual targets.</p>
            <p><strong>[Retirement &amp; Incorporation]</strong></p>
            <p>1. Critical &amp; urgent EOS product retirement/incorporation rate is ${pct(prodRate, 2)}, ${prodTargetStatus}, forecast year-end completion rate is ${pct(prodPlanned, 1)}, but ${prod.total.noPlan} sets still have no retirement plan ${prodCustText}, recommend system departments to continue driving;</p>
            <p>2. High-risk EOS version upgrade/incorporation rate is ${pct(verRate, 2)}, forecast year-end completion rate is ${pct(verPlanned, 1)}, ${verRiskText}, of which:<br>
            1) Planned: ${verPlanCustSummary}, version upgrades must be completed within the year according to schedule;<br>
            2) Unplanned: ${verNoPlanCustSummary} currently have no incorporation plans, please have ${urgentCustomerNames} system departments accelerate customer alignment and confirm incorporation plans by October at the latest to ensure upgrades are completed within the year.</p>
        </div>`;
    }

    function buildProductCopyHtmlEn(product) {
        const config = readMappingConfig();
        const minThreshold = config.minThreshold;
        const total = product.total;
        const noPlanAccounts = (product.accounts || []).filter(a => (a.noPlan || 0) > 0).sort((a, b) => b.noPlan - a.noPlan);

        const focusDetails = noPlanAccounts.map(a => {
            const cust = mapCustomerName(a.customer);
            const filteredItems = (a.topNoPlanItems || []).filter(i => (i.noPlan || 0) >= minThreshold);
            if (!filteredItems.length) {
                return (a.noPlan || 0) >= minThreshold ? `${escapeHtml(cust)} ${a.noPlan} sets` : '';
            }
            const items = filteredItems.map(i => `${escapeHtml(i.label)} ${i.noPlan} sets`).join('/');
            return `${escapeHtml(cust)} ${a.noPlan} sets (${items})`;
        }).filter(Boolean).join(', ');

        return `<div class="topic-monthly-copy">
            <p>Annual baseline: ${total.quantity} sets, completed incorporation: ${total.incorporated} sets, completion rate: ${pct(total.currentRate, 2)}; pending incorporation: ${total.pending} sets, of which ${total.noPlan} sets have no plan for this year.</p>
            <p>Key Focus: ${total.noPlan} sets currently have no retirement plan, recommend completing customer communication and confirming retirement plans within the year, including: ${focusDetails || 'No key items pending'}.</p>
        </div>`;
    }

    function buildVersionCopyHtmlEn(version) {
        const config = readMappingConfig();
        const minThreshold = config.minThreshold;
        const total = version.total;
        const planAccounts = (version.accounts || []).filter(a => (a.annualPlan || 0) > 0).sort((a, b) => b.annualPlan - a.annualPlan);
        const noPlanAccounts = (version.accounts || []).filter(a => (a.noPlan || 0) > 0).sort((a, b) => b.noPlan - a.noPlan);

        const planDetails = planAccounts.map(a => {
            const cust = mapCustomerName(a.customer);
            const filteredItems = (a.topPlanItems || []).filter(i => (i.annualPlan || 0) >= minThreshold);
            if (!filteredItems.length) {
                return (a.annualPlan || 0) >= minThreshold ? `${escapeHtml(cust)} ${a.annualPlan} sets` : '';
            }
            const items = filteredItems.map(i => `${escapeHtml(i.label)} ${i.annualPlan} sets`).join('/');
            return `${escapeHtml(cust)} ${a.annualPlan} sets (${items})`;
        }).filter(Boolean).join(', ');

        const topNoPlan = noPlanAccounts.slice(0, 2);
        const hasMoreNoPlan = noPlanAccounts.length > 2 || (topNoPlan[0]?.topNoPlanItems?.length > 2);
        const noPlanDetails = topNoPlan.map(a => {
            const cust = mapCustomerName(a.customer);
            const filteredItems = (a.topNoPlanItems || []).filter(i => (i.noPlan || 0) >= minThreshold);
            if (!filteredItems.length) {
                return (a.noPlan || 0) >= minThreshold ? `${escapeHtml(cust)} ${a.noPlan} sets` : '';
            }
            const items = filteredItems.map(i => `${escapeHtml(i.label)} ${i.noPlan} sets`).join('/');
            return `${escapeHtml(cust)} ${a.noPlan} sets (${items})`;
        }).filter(Boolean).join(', ');

        return `<div class="topic-monthly-copy">
            <p>Annual baseline: ${total.quantity} sets, completed incorporation: ${total.incorporated} sets, completion rate: ${pct(total.currentRate, 2)}; pending incorporation: ${total.pending} sets, of which ${total.annualPlan} sets are planned for completion this year, and ${total.noPlan} sets have no plan for this year.</p>
            <p>Key Focus:<br>
            1) Planned: Total ${total.annualPlan} sets, ensure completion of upgrades within the year, including: ${planDetails || 'None'}.<br>
            2) Unplanned: Total ${total.noPlan} sets, including: ${noPlanDetails || 'None'}${hasMoreNoPlan ? ' etc.' : ''}.</p>
        </div>`;
    }

    function renderMonthlySectionEn(section, labelEn) {
        const { total, accounts } = section;
        const cells = metric => `<td>${metric.quantity}</td><td>${metric.incorporated}</td><td>${pct(metric.currentRate, 1)}</td><td>${metric.pending}</td><td>${metric.annualPlan}</td><td>${metric.noPlan}</td><td>${pct(metric.plannedRate, 1)}</td>`;
        const rows = accounts.map(item => `<tr><th scope="row">${escapeHtml(mapCustomerName(item.customer))}</th>${cells(item)}</tr>`).join('');
        const copyHtml = labelEn === 'Product' ? buildProductCopyHtmlEn(section) : buildVersionCopyHtmlEn(section);
        const tableNum = labelEn === 'Product' ? 1 : 2;
        const tableId = labelEn === 'Product' ? 'prod' : 'ver';

        return `<section class="topic-monthly-section">
            <h3 class="topic-report-item-title">➤ Retirement &amp; Incorporation Progress (Critical &amp; Urgent EOS ${labelEn}):</h3>
            ${copyHtml}
            <div class="topic-table-wrap topic-report-table-wrap">
                <table class="topic-monthly-table" id="eosMonthlyTableEn_${tableId}" data-table-id="${tableId}">
                    <thead>
                        <tr><th rowspan="3">Customer</th><th colspan="7">Critical &amp; Urgent EOS · ${labelEn}</th></tr>
                        <tr><th rowspan="2">Total</th><th rowspan="2">Incorporated</th><th rowspan="2">Current Rate</th><th colspan="3">Pending</th><th rowspan="2">Post-Plan Rate</th></tr>
                        <tr><th>Subtotal</th><th>This Year's Plan</th><th>No Plan</th></tr>
                    </thead>
                    <tbody>
                        ${rows}
                        <tr class="topic-monthly-total"><th scope="row">Total</th>${cells(total)}</tr>
                    </tbody>
                </table>
            </div>
            <p class="topic-report-caption">(Table ${tableNum}: ${labelEn} EOS Incorporation Progress)</p>
        </section>`;
    }

    const MONTHLY_COPY_SELECTOR = '.topic-report-title, .topic-report-objective p, .topic-report-overview-copy p, .topic-report-item-title, .topic-monthly-section .topic-monthly-copy p, .topic-monthly-footnote';
    const FIXED_COPY_SELECTOR = '.topic-fixed-block .topic-report-item-title, .topic-fixed-block .topic-monthly-copy p, .topic-fixed-footnote, .topic-report-remarks-block .topic-monthly-copy p, .topic-report-contact-copy, .topic-report-signature';
    let editingBlock = null;
    let editingRange = null;

    function copyStorageKey(scope) {
        if (state.monthlyTopicKey && state.monthlyTopicKey !== 'eos') return genericStorageKey('monthly-copy', scope);
        let tenant = 'default';
        try { tenant = localStorage.getItem('tools_tenant_id') || tenant; } catch (_) { /* storage may be disabled */ }
        return `topic-eos:monthly-copy:v1:${tenant}:${scope.startsWith('fixed') ? scope : `month:${scope}:${state.eosMonthlyReport?.month || ''}`}`;
    }

    function readCopyPreferences(scope) {
        try {
            const value = JSON.parse(localStorage.getItem(copyStorageKey(scope)) || '{}');
            return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        } catch (_) { return {}; }
    }

    function syncedCnStorageKey(scope) {
        if (state.monthlyTopicKey && state.monthlyTopicKey !== 'eos') return genericStorageKey('synced-cn', scope.replace(/-en$/, ''));
        let tenant = 'default';
        try { tenant = localStorage.getItem('tools_tenant_id') || tenant; } catch (_) { /* storage may be disabled */ }
        const baseScope = scope.replace(/-en$/, '');
        return `topic-eos:synced-cn:v1:${tenant}:${baseScope.startsWith('fixed') ? baseScope : `month:${baseScope}:${state.eosMonthlyReport?.month || ''}`}`;
    }

    function readSyncedCnPreferences(scope) {
        try {
            const value = JSON.parse(localStorage.getItem(syncedCnStorageKey(scope)) || '{}');
            return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        } catch (_) { return {}; }
    }

    function saveSyncedCn(scope, key, cnHtml) {
        const baseScope = scope.replace(/-en$/, '');
        const prefs = readSyncedCnPreferences(baseScope);
        prefs[key] = sanitizeCopyHtml(cnHtml).trim();
        try {
            localStorage.setItem(syncedCnStorageKey(baseScope), JSON.stringify(prefs));
        } catch (_) {}
    }

    function clearSyncedCn(scope, key) {
        const baseScope = scope.replace(/-en$/, '');
        const prefs = readSyncedCnPreferences(baseScope);
        if (prefs[key]) {
            delete prefs[key];
            try {
                localStorage.setItem(syncedCnStorageKey(baseScope), JSON.stringify(prefs));
            } catch (_) {}
        }
    }

    function preTranslateStorageKey(scope) {
        if (state.monthlyTopicKey && state.monthlyTopicKey !== 'eos') return genericStorageKey('pre-trans', scope);
        let tenant = 'default';
        try { tenant = localStorage.getItem('tools_tenant_id') || tenant; } catch (_) {}
        return `topic-eos:pre-trans:v1:${tenant}:${scope.startsWith('fixed') ? scope : `month:${scope}:${state.eosMonthlyReport?.month || ''}`}`;
    }

    function readPreTranslatePreferences(scope) {
        try {
            const value = JSON.parse(localStorage.getItem(preTranslateStorageKey(scope)) || '{}');
            return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        } catch (_) { return {}; }
    }

    function savePreTranslate(scope, key, html) {
        const prefs = readPreTranslatePreferences(scope);
        if (!prefs[key]) {
            prefs[key] = sanitizeCopyHtml(html).trim();
            try { localStorage.setItem(preTranslateStorageKey(scope), JSON.stringify(prefs)); } catch (_) {}
        }
    }

    function clearPreTranslate(scope, key) {
        const prefs = readPreTranslatePreferences(scope);
        if (prefs[key]) {
            delete prefs[key];
            try { localStorage.setItem(preTranslateStorageKey(scope), JSON.stringify(prefs)); } catch (_) {}
        }
    }

    function sanitizeCopyHtml(html) {
        const parsed = new DOMParser().parseFromString(`<div>${String(html || '').slice(0, 10000)}</div>`, 'text/html');
        const result = document.createElement('div');
        const safeColor = value => /^#[0-9a-f]{3,8}$/i.test(value || '') || /^rgba?\([\d\s.,%]+\)$/i.test(value || '') ? value : '';
        function copyNode(source, target) {
            if (source.nodeType === Node.TEXT_NODE) { target.appendChild(document.createTextNode(source.textContent)); return; }
            if (source.nodeType !== Node.ELEMENT_NODE) return;
            const tag = source.tagName.toLowerCase();
            if (['script', 'style', 'svg', 'iframe', 'object'].includes(tag)) return;
            if (tag === 'br') { target.appendChild(document.createElement('br')); return; }
            let destination = target;
            if (tag === 'b' || tag === 'strong' || source.style.fontWeight === 'bold' || Number(source.style.fontWeight) >= 600) {
                const bold = document.createElement('strong'); destination.appendChild(bold); destination = bold;
            }
            const color = safeColor(tag === 'font' ? source.getAttribute('color') : source.style.color);
            if (color) { const span = document.createElement('span'); span.style.color = color; destination.appendChild(span); destination = span; }
            Array.from(source.childNodes).forEach(child => copyNode(child, destination));
            if (tag === 'div' || tag === 'p') target.appendChild(document.createElement('br'));
        }
        Array.from(parsed.body.firstElementChild?.childNodes || []).forEach(node => copyNode(node, result));
        return result.innerHTML.replace(/(?:<br>)+$/i, '');
    }

    const SOURCE_TIME_HIDDEN_KEY = 'topic-eos:hide-source-time';

    function updateSourceTimeVisibility(hidden) {
        const sourceEl = elements?.eosMonthlySource || (typeof document !== 'undefined' ? document.getElementById('eosMonthlySource') : null);
        const icon = elements?.eosToggleSourceTimeIcon || (typeof document !== 'undefined' ? document.getElementById('eosToggleSourceTimeIcon') : null);
        const text = elements?.eosToggleSourceTimeText || (typeof document !== 'undefined' ? document.getElementById('eosToggleSourceTimeText') : null);
        const btn = elements?.eosToggleSourceTimeBtn || (typeof document !== 'undefined' ? document.getElementById('eosToggleSourceTimeBtn') : null);
        if (sourceEl) {
            if (hidden) {
                sourceEl.classList.add('is-hidden');
                if (icon) icon.textContent = '👁️‍🗨️';
                if (text) text.textContent = '显示导入时间';
                if (btn) btn.classList.add('is-active');
            } else {
                sourceEl.classList.remove('is-hidden');
                if (icon) icon.textContent = '👁️';
                if (text) text.textContent = '隐藏导入时间';
                if (btn) btn.classList.remove('is-active');
            }
        }
        if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
            const navTags = document.querySelectorAll('.topic-report-nav-tag');
            const dividerBadges = document.querySelectorAll('.topic-report-divider-badge');
            const dividerEns = document.querySelectorAll('.topic-report-divider-en');

            navTags.forEach(el => el.classList.toggle('is-hidden', Boolean(hidden)));
            dividerBadges.forEach(el => el.classList.toggle('is-hidden', Boolean(hidden)));
            dividerEns.forEach(el => el.classList.toggle('is-hidden', Boolean(hidden)));
        }
    }

    function setCopyStatus(message) { elements.eosCopyStatus.textContent = message; }

    function saveCopy(block) {
        const scope = block.dataset.eosCopyScope;
        const preferences = readCopyPreferences(scope);
        preferences[block.dataset.eosCopyKey] = sanitizeCopyHtml(block.innerHTML);
        try { localStorage.setItem(copyStorageKey(scope), JSON.stringify(preferences)); setCopyStatus('已自动保存'); }
        catch (_) { setCopyStatus('浏览器未能保存偏好，本次修改仅在当前页面有效'); }
    }

    function activateCopy(root, selector, scope) {
        if (!root) return;
        const preferences = readCopyPreferences(scope);
        root.querySelectorAll(selector).forEach((block, index) => {
            const key = `copy-${index}`;
            const defaultKey = `${scope}-${key}`;
            if (!state.copyDefaults.has(defaultKey)) {
                state.copyDefaults.set(defaultKey, sanitizeCopyHtml(block.innerHTML));
            }
            if (scope.startsWith('fixed') && !state.fixedCopyDefaults.has(defaultKey)) {
                state.fixedCopyDefaults.set(defaultKey, block.innerHTML);
            }
            if (typeof preferences[key] === 'string') {
                block.innerHTML = sanitizeCopyHtml(preferences[key]);
            }
            block.contentEditable = 'true';
            block.spellcheck = false;
            block.classList.add('topic-editable');
            block.dataset.eosCopyKey = key;
            block.dataset.eosCopyScope = scope;
            block.title = '点击修改文字；选中文字可加粗或改色';
            block.addEventListener('focus', () => {
                hideDiffPopover(true);
            });
            block.addEventListener('input', () => {
                saveCopy(block);
                if (scope.endsWith('-en')) {
                    const cnScope = scope.replace(/-en$/, '');
                    const sheet = elements?.eosReportSheet || document.getElementById('eosReportSheet');
                    const cnEl = sheet ? sheet.querySelector(`[data-eos-copy-scope="${cnScope}"][data-eos-copy-key="${key}"]`) : null;
                    if (cnEl) {
                        saveSyncedCn(scope, key, cnEl.innerHTML);
                    }
                }
                updateBilingualSyncStatus();
            });
            block.addEventListener('blur', () => {
                const clean = sanitizeCopyHtml(block.innerHTML);
                if (block.innerHTML !== clean) block.innerHTML = clean;
                if (scope.endsWith('-en')) {
                    const cnScope = scope.replace(/-en$/, '');
                    const sheet = elements?.eosReportSheet || document.getElementById('eosReportSheet');
                    const cnEl = sheet ? sheet.querySelector(`[data-eos-copy-scope="${cnScope}"][data-eos-copy-key="${key}"]`) : null;
                    if (cnEl) {
                        saveSyncedCn(scope, key, cnEl.innerHTML);
                    }
                }
                updateBilingualSyncStatus();
            });
            block.addEventListener('paste', event => {
                event.preventDefault();
                document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
            });
            block.addEventListener('drop', event => event.preventDefault());
        });
    }

    function activateTableCells(table, tableId, scope) {
        if (!table) return;
        const preferences = readCopyPreferences(scope);
        const tbody = table.querySelector('tbody') || table;
        const rows = Array.from(tbody.querySelectorAll('tr'));
        rows.forEach((tr, rIndex) => {
            const cells = Array.from(tr.querySelectorAll('td, th[scope="row"]'));
            cells.forEach((cell, cIndex) => {
                const key = `cell-${tableId}-r${rIndex}-c${cIndex}`;
                const defaultKey = `${scope}-${key}`;
                if (!state.copyDefaults.has(defaultKey)) {
                    state.copyDefaults.set(defaultKey, sanitizeCopyHtml(cell.innerHTML));
                }
                if (scope.startsWith('fixed') && !state.fixedCopyDefaults.has(defaultKey)) {
                    state.fixedCopyDefaults.set(defaultKey, sanitizeCopyHtml(cell.innerHTML));
                }
                if (typeof preferences[key] === 'string') {
                    cell.innerHTML = sanitizeCopyHtml(preferences[key]);
                }
                cell.contentEditable = 'true';
                cell.spellcheck = false;
                cell.classList.add('topic-editable', 'topic-cell-editable');
                cell.dataset.eosCopyKey = key;
                cell.dataset.eosCopyScope = scope;
                cell.dataset.eosTableId = tableId;
                cell.title = '点击修改表格文字；选中文字可加粗或改色';

                cell.addEventListener('focus', () => {
                    hideDiffPopover(true);
                });
                cell.addEventListener('input', () => {
                    saveCopy(cell);
                    if (scope.endsWith('-en')) {
                        const cnScope = scope.replace(/-en$/, '');
                        const sheet = elements?.eosReportSheet || document.getElementById('eosReportSheet');
                        const cnEl = sheet ? sheet.querySelector(`[data-eos-copy-scope="${cnScope}"][data-eos-copy-key="${key}"]`) : null;
                        if (cnEl) {
                            saveSyncedCn(scope, key, cnEl.innerHTML);
                        }
                    }
                    updateBilingualSyncStatus();
                });
                cell.addEventListener('blur', () => {
                    const clean = sanitizeCopyHtml(cell.innerHTML);
                    if (cell.innerHTML !== clean) cell.innerHTML = clean;
                    if (scope.endsWith('-en')) {
                        const cnScope = scope.replace(/-en$/, '');
                        const sheet = elements?.eosReportSheet || document.getElementById('eosReportSheet');
                        const cnEl = sheet ? sheet.querySelector(`[data-eos-copy-scope="${cnScope}"][data-eos-copy-key="${key}"]`) : null;
                        if (cnEl) {
                            saveSyncedCn(scope, key, cnEl.innerHTML);
                        }
                    }
                    updateBilingualSyncStatus();
                });
                cell.addEventListener('keydown', event => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        const nextRow = rows[rIndex + 1];
                        const nextCell = nextRow ? Array.from(nextRow.querySelectorAll('td, th[scope="row"]'))[cIndex] : null;
                        if (nextCell) nextCell.focus();
                        else cell.blur();
                    }
                });
                cell.addEventListener('paste', event => {
                    event.preventDefault();
                    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
                });
                cell.addEventListener('drop', event => event.preventDefault());
            });
        });
    }

    function getBlockLabel(el) {
        if (!el) return '正文';
        if (el.tagName === 'H3' || el.tagName === 'H4') return el.textContent.replace(/[➤:：]/g, '').trim().slice(0, 14);
        if (el.dataset.eosTableId) {
            const tableMap = { prod: '产品收编表', ver: '版本收编表', 'fixed-prod': '产品风险进展表', 'fixed-ver': '版本风险告知表' };
            const tableName = tableMap[el.dataset.eosTableId] || '表格';
            const row = el.closest('tr');
            const rowHeader = row ? row.querySelector('th[scope="row"]')?.textContent.trim() : '';
            return rowHeader ? `${tableName} (${rowHeader})` : tableName;
        }
        const titleEl = el.closest('section, div')?.querySelector?.('h3, h4, .topic-report-section-bar');
        if (titleEl) return titleEl.textContent.replace(/[➤:：]/g, '').trim().slice(0, 14);
        return el.textContent.slice(0, 12).trim() || '正文段落';
    }

    async function checkAiAssistantStatus() {
        try {
            const settings = await API.get('/api/ai-settings');
            state.aiSettings = settings;
            state.isAiConnected = Boolean(settings && settings.hasApiKey && settings.keyLooksValid);
        } catch (_) {
            state.aiSettings = null;
            state.isAiConnected = false;
        }
        updateBilingualSyncStatus();
    }

    async function performAiTranslate(cnEl, enEl, btn) {
        if (!cnEl || !enEl) return;
        if (!state.isAiConnected) {
            AppDialog.alert('未在全局配置中对接 AI 助手，请管理员在导航栏「设置 > AI 助手」中配置 API Token。', { title: '提示', tone: 'warning' });
            return;
        }
        const contextReport = state.eosMonthlyReport;
        const originalHtml = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="topic-ai-spinner"></span> 正在翻译…';
        }
        try {
            const cnHtml = cnEl.innerHTML.trim();
            const res = await API.post('/api/ai/translate', {
                text: cnHtml,
                context: isGenericMonthly() ? monthlyDefinition().en : 'Egypt Rep Office EOS Monthly Report'
            });
            if (!res || !res.translatedText) {
                throw new Error('AI 服务未返回翻译结果');
            }
            if (state.eosMonthlyReport !== contextReport || !enEl.isConnected) return;
            savePreTranslate(enEl.dataset.eosCopyScope, enEl.dataset.eosCopyKey, enEl.innerHTML);
            enEl._preTranslateHtml = enEl.innerHTML;
            enEl.innerHTML = sanitizeCopyHtml(res.translatedText);
            saveCopy(enEl);
            saveSyncedCn(enEl.dataset.eosCopyScope, enEl.dataset.eosCopyKey, cnEl.innerHTML);
            enEl.dispatchEvent(new Event('input', { bubbles: true }));
            updateBilingualSyncStatus();
            setCopyStatus('已由 AI 助手完成专业翻译，粗体与颜色格式已精准对齐！');
        } catch (err) {
            console.error('AI 翻译失败:', err);
            AppDialog.alert(`AI 翻译失败：${err.message || '网络异常'}`, { title: 'AI 翻译失败', tone: 'error' });
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        }
    }

    async function performAiTranslateAll(items, btn) {
        if (!items || !items.length) return;
        if (!state.isAiConnected) {
            AppDialog.alert('未在全局配置中对接 AI 助手，请管理员在导航栏「设置 > AI 助手」中配置 API Token。', { title: '提示', tone: 'warning' });
            return;
        }
        const contextReport = state.eosMonthlyReport;
        const originalHtml = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="topic-ai-spinner"></span> 批量翻译中…';
        }
        let successCount = 0;
        try {
            for (const item of items) {
                if (state.eosMonthlyReport !== contextReport) break;
                if (item.cnEl && item.enEl) {
                    const cnHtml = item.cnEl.innerHTML.trim();
                    const res = await API.post('/api/ai/translate', {
                        text: cnHtml,
                        context: isGenericMonthly() ? monthlyDefinition().en : 'Egypt Rep Office EOS Monthly Report'
                    });
                    if (state.eosMonthlyReport !== contextReport || !item.enEl.isConnected) break;
                    if (res && res.translatedText) {
                        savePreTranslate(item.enEl.dataset.eosCopyScope, item.enEl.dataset.eosCopyKey, item.enEl.innerHTML);
                        item.enEl._preTranslateHtml = item.enEl.innerHTML;
                        item.enEl.innerHTML = sanitizeCopyHtml(res.translatedText);
                        saveCopy(item.enEl);
                        saveSyncedCn(item.enEl.dataset.eosCopyScope, item.enEl.dataset.eosCopyKey, item.cnEl.innerHTML);
                        item.enEl.dispatchEvent(new Event('input', { bubbles: true }));
                        successCount++;
                    }
                }
            }
            updateBilingualSyncStatus();
            setCopyStatus(`已由 AI 助手完成全部 ${successCount} 处内容的同步翻译与格式对齐！`);
        } catch (err) {
            console.error('批量 AI 翻译异常:', err);
            AppDialog.alert(`批量翻译部分完成：成功 ${successCount} 处，错误：${err.message}`, { title: '操作失败', tone: 'error' });
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        }
    }

    // Floating Diff Popover Controller
    let diffPopoverEl = null;
    let popoverHideTimer = null;
    let activePopoverContext = null;

    function getOrCreateDiffPopover() {
        if (diffPopoverEl && document.body.contains(diffPopoverEl)) return diffPopoverEl;

        const popover = document.createElement('div');
        popover.id = 'eosDiffPopover';
        popover.className = 'topic-diff-popover print-hide';
        popover.setAttribute('data-html2canvas-ignore', 'true');
        popover.innerHTML = `
            <div class="topic-diff-header">
                <div class="topic-diff-title-wrap">
                    <span class="topic-diff-icon">🔍</span>
                    <span class="topic-diff-title">中文修改对比与参考</span>
                    <span class="topic-diff-status-tag" id="eosDiffStatusTag">⚠️ 英文待同步</span>
                </div>
                <button type="button" class="topic-diff-close" title="关闭">✕</button>
            </div>
            <div class="topic-diff-body">
                <div class="topic-diff-section is-before">
                    <div class="topic-diff-section-header">
                        <span class="topic-diff-section-label">【以前 / 修改前】</span>
                        <span class="topic-diff-section-sub">原始模板或上次同步的中文</span>
                    </div>
                    <div class="topic-diff-content" id="eosDiffBeforeContent"></div>
                </div>
                <div class="topic-diff-arrow">⬇ 当前修改为 ⬇</div>
                <div class="topic-diff-section is-after">
                    <div class="topic-diff-section-header">
                        <span class="topic-diff-section-label">【现在 / 修改后】</span>
                        <span class="topic-diff-section-sub">当前最新中文内容（含粗体/颜色格式）</span>
                    </div>
                    <div class="topic-diff-content" id="eosDiffAfterContent"></div>
                </div>
            </div>
            <div class="topic-diff-footer">
                <div class="topic-diff-tip">💡 提示：可一键复制修改后的中文，或直接点击 AI 翻译同步</div>
                <div class="topic-diff-actions">
                    <button type="button" class="topic-diff-copy-btn" id="eosDiffCopyBtn">
                        <span class="topic-diff-copy-icon">📋</span>
                        <span class="topic-diff-copy-label">一键复制文字</span>
                    </button>
                    <button type="button" class="topic-diff-revert-btn" id="eosDiffRevertBtn" title="撤回本段英文的翻译，恢复为翻译前的内容" style="display: none;">
                        <span>↩ 撤回翻译</span>
                    </button>
                    <button type="button" class="topic-diff-ai-btn" id="eosDiffAiBtn">
                        <span>✨ AI 翻译同步</span>
                    </button>
                </div>
            </div>
        `;

        popover.addEventListener('mouseenter', () => {
            if (popoverHideTimer) {
                clearTimeout(popoverHideTimer);
                popoverHideTimer = null;
            }
        });

        popover.addEventListener('mouseleave', () => {
            popoverHideTimer = setTimeout(() => hideDiffPopover(true), 250);
        });

        const closeBtn = popover.querySelector('.topic-diff-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                hideDiffPopover(true);
            });
        }

        const copyBtn = popover.querySelector('#eosDiffCopyBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                if (!activePopoverContext) return;
                const textToCopy = (activePopoverContext.afterPlain || '').trim();
                if (!textToCopy) return;

                let copied = false;
                try {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        await navigator.clipboard.writeText(textToCopy);
                        copied = true;
                    }
                } catch (_) {}
                if (!copied) {
                    try {
                        const textarea = document.createElement('textarea');
                        textarea.value = textToCopy;
                        textarea.style.position = 'fixed';
                        textarea.style.left = '-9999px';
                        document.body.appendChild(textarea);
                        textarea.select();
                        document.execCommand('copy');
                        document.body.removeChild(textarea);
                        copied = true;
                    } catch (_) {}
                }

                if (copied) {
                    const label = copyBtn.querySelector('.topic-diff-copy-label');
                    copyBtn.classList.add('is-copied');
                    if (label) label.textContent = '✓ 已复制！';
                    setCopyStatus('已将修改后的中文文字复制到剪贴板');
                    setTimeout(() => {
                        copyBtn.classList.remove('is-copied');
                        if (label) label.textContent = '一键复制文字';
                    }, 2000);
                }
            });
        }

        const revertBtn = popover.querySelector('#eosDiffRevertBtn');
        if (revertBtn) {
            revertBtn.addEventListener('click', () => {
                if (!activePopoverContext || !activePopoverContext.enEl) return;
                const targetEn = activePopoverContext.enEl;
                const enScope = targetEn.dataset.eosCopyScope;
                const enKey = targetEn.dataset.eosCopyKey;
                const enDefaultKey = `${enScope}-${enKey}`;
                const defaultHtml = (state.copyDefaults.get(enDefaultKey) || '').trim();

                const preTransPrefs = readPreTranslatePreferences(enScope);
                const preHtml = targetEn._preTranslateHtml || preTransPrefs[enKey] || defaultHtml;

                // 1. Revert HTML in targetEn
                targetEn.innerHTML = sanitizeCopyHtml(preHtml);

                // 2. Update copy preferences
                const copyPrefs = readCopyPreferences(enScope);
                if (targetEn.innerHTML.trim() === defaultHtml) {
                    delete copyPrefs[enKey];
                } else {
                    copyPrefs[enKey] = targetEn.innerHTML;
                }
                try {
                    localStorage.setItem(copyStorageKey(enScope), JSON.stringify(copyPrefs));
                } catch (_) {}

                // 3. Clear pre-translate snapshot
                clearPreTranslate(enScope, enKey);
                delete targetEn._preTranslateHtml;

                // 4. Clear synced baseline for this item
                clearSyncedCn(enScope, enKey);

                // 5. Update bilingual sync status (do not dispatch input to prevent re-marking as synced)
                updateBilingualSyncStatus();

                // 6. Immediate feedback in popover
                revertBtn.classList.add('is-reverted');
                revertBtn.innerHTML = '<span>✓ 已撤回</span>';
                revertBtn.disabled = true;

                const statusTag = popover.querySelector('#eosDiffStatusTag');
                if (statusTag) {
                    statusTag.className = 'topic-diff-status-tag is-warn';
                    statusTag.textContent = '⚠️ 英文待同步';
                }

                const aiBtn = popover.querySelector('#eosDiffAiBtn');
                if (aiBtn) {
                    aiBtn.style.display = 'inline-flex';
                    aiBtn.disabled = !state.isAiConnected;
                    aiBtn.classList.toggle('is-disabled', !state.isAiConnected);
                }

                if (activePopoverContext) {
                    activePopoverContext.isSynced = false;
                }

                setCopyStatus('已成功撤回该段翻译，已恢复为翻译前版本！');

                setTimeout(() => {
                    if (revertBtn) {
                        revertBtn.classList.remove('is-reverted');
                        revertBtn.innerHTML = '<span>↩ 撤回翻译</span>';
                        revertBtn.disabled = false;
                        revertBtn.style.display = 'none';
                    }
                }, 1500);
            });
        }

        const aiBtn = popover.querySelector('#eosDiffAiBtn');
        if (aiBtn) {
            aiBtn.addEventListener('click', async () => {
                if (!activePopoverContext || !activePopoverContext.cnEl || !activePopoverContext.enEl) return;
                const targetCn = activePopoverContext.cnEl;
                const targetEn = activePopoverContext.enEl;
                await performAiTranslate(targetCn, targetEn, aiBtn);
                if (activePopoverContext && activePopoverContext.enEl === targetEn) {
                    const statusTag = popover.querySelector('#eosDiffStatusTag');
                    if (statusTag) {
                        statusTag.className = 'topic-diff-status-tag is-synced';
                        statusTag.textContent = '✓ 英文已同步';
                    }
                    aiBtn.style.display = 'none';
                    const revertBtnEl = popover.querySelector('#eosDiffRevertBtn');
                    if (revertBtnEl) {
                        revertBtnEl.style.display = 'inline-flex';
                        revertBtnEl.classList.remove('is-reverted');
                        revertBtnEl.innerHTML = '<span>↩ 撤回翻译</span>';
                        revertBtnEl.disabled = false;
                    }
                    activePopoverContext.isSynced = true;
                }
            });
        }

        document.body.appendChild(popover);
        diffPopoverEl = popover;
        return popover;
    }

    function showDiffPopover(anchorEl, context) {
        if (!anchorEl || !context || !context.isModified) return;
        if (popoverHideTimer) {
            clearTimeout(popoverHideTimer);
            popoverHideTimer = null;
        }

        const popover = getOrCreateDiffPopover();
        activePopoverContext = context;

        const statusTag = popover.querySelector('#eosDiffStatusTag');
        const beforeContent = popover.querySelector('#eosDiffBeforeContent');
        const afterContent = popover.querySelector('#eosDiffAfterContent');
        const aiBtn = popover.querySelector('#eosDiffAiBtn');
        const revertBtn = popover.querySelector('#eosDiffRevertBtn');

        const enEl = context.enEl;
        const enScope = enEl?.dataset?.eosCopyScope;
        const enKey = enEl?.dataset?.eosCopyKey;
        const hasPreTrans = Boolean(
            (enEl && enEl._preTranslateHtml) ||
            (enScope && enKey && readPreTranslatePreferences(enScope)[enKey])
        );
        const canRevert = Boolean(context.isSynced || hasPreTrans);

        if (context.isSynced) {
            if (statusTag) {
                statusTag.className = 'topic-diff-status-tag is-synced';
                statusTag.textContent = '✓ 英文已同步';
            }
            if (aiBtn) aiBtn.style.display = 'none';
            if (revertBtn) {
                revertBtn.style.display = 'inline-flex';
                revertBtn.classList.remove('is-reverted');
                revertBtn.innerHTML = '<span>↩ 撤回翻译</span>';
                revertBtn.disabled = false;
            }
        } else {
            if (statusTag) {
                statusTag.className = 'topic-diff-status-tag is-warn';
                statusTag.textContent = '⚠️ 英文待同步';
            }
            if (aiBtn) {
                aiBtn.style.display = 'inline-flex';
                aiBtn.disabled = !state.isAiConnected;
                aiBtn.classList.toggle('is-disabled', !state.isAiConnected);
            }
            if (revertBtn) {
                if (canRevert) {
                    revertBtn.style.display = 'inline-flex';
                    revertBtn.classList.remove('is-reverted');
                    revertBtn.innerHTML = '<span>↩ 撤回翻译</span>';
                    revertBtn.disabled = false;
                } else {
                    revertBtn.style.display = 'none';
                }
            }
        }

        if (beforeContent) beforeContent.innerHTML = context.beforeHtml || '<span style="color:#94a3b8;">（无历史内容）</span>';
        if (afterContent) afterContent.innerHTML = context.afterHtml || '<span style="color:#94a3b8;">（无修改内容）</span>';

        const rect = anchorEl.getBoundingClientRect();
        const popoverWidth = 450;
        let left = rect.left + (rect.width / 2) - (popoverWidth / 2);
        left = Math.max(16, Math.min(window.innerWidth - popoverWidth - 16, left));

        popover.style.left = `${left}px`;
        popover.classList.add('is-visible');

        const popoverHeight = popover.offsetHeight || 300;
        let top;
        if (rect.top > popoverHeight + 16) {
            top = rect.top - popoverHeight - 8;
        } else {
            top = rect.bottom + 8;
        }
        top = Math.max(10, Math.min(window.innerHeight - popoverHeight - 10, top));
        popover.style.top = `${top}px`;
    }

    function hideDiffPopover(immediate = false) {
        if (!diffPopoverEl) return;
        if (immediate) {
            if (popoverHideTimer) {
                clearTimeout(popoverHideTimer);
                popoverHideTimer = null;
            }
            diffPopoverEl.classList.remove('is-visible');
            activePopoverContext = null;
        } else {
            if (popoverHideTimer) clearTimeout(popoverHideTimer);
            popoverHideTimer = setTimeout(() => {
                if (diffPopoverEl) diffPopoverEl.classList.remove('is-visible');
                activePopoverContext = null;
            }, 250);
        }
    }

    function attachDiffPopoverListeners(targetEl, getContext) {
        if (!targetEl) return;
        targetEl._getDiffPopoverContext = getContext;
        if (!targetEl._hasDiffPopoverListeners) {
            targetEl._hasDiffPopoverListeners = true;
            targetEl.addEventListener('mouseenter', () => {
                const ctx = typeof targetEl._getDiffPopoverContext === 'function' ? targetEl._getDiffPopoverContext() : targetEl._getDiffPopoverContext;
                if (ctx && ctx.isModified) {
                    showDiffPopover(targetEl, ctx);
                }
            });
            targetEl.addEventListener('mouseleave', () => {
                hideDiffPopover(false);
            });
        }
    }

    function renderGutterBadges(modifiedItems) {
        const gutter = elements?.eosReportGutter || (typeof document !== 'undefined' ? document.getElementById('eosReportGutter') : null);
        const sheet = elements?.eosReportSheet || (typeof document !== 'undefined' ? document.getElementById('eosReportSheet') : null);
        if (!gutter || !sheet) return;
        gutter.innerHTML = '';
        if (!modifiedItems || !modifiedItems.length) return;

        const sheetRect = sheet.getBoundingClientRect();
        const placedTops = [];

        modifiedItems.forEach(item => {
            const { type, cnEl, enEl, label } = item;
            if (cnEl && cnEl.isConnected) {
                const cnRect = cnEl.getBoundingClientRect();
                let top = cnRect.top - sheetRect.top + (cnRect.height / 2) - 12;
                top = Math.max(0, top);
                while (placedTops.some(t => Math.abs(t - top) < 24)) {
                    top += 24;
                }
                placedTops.push(top);

                const badge = document.createElement('div');
                badge.className = 'topic-gutter-badge is-cn print-hide';
                badge.setAttribute('data-html2canvas-ignore', 'true');
                badge.style.top = `${Math.round(top)}px`;
                badge.title = `点击定位到修改的中文内容（${label || '正文'}）`;
                badge.innerHTML = '<span>✏️ 中文已改</span>';
                badge.addEventListener('click', () => {
                    cnEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    cnEl.focus();
                });
                gutter.appendChild(badge);
            }

            if (enEl && enEl.isConnected) {
                const enRect = enEl.getBoundingClientRect();
                let top = enRect.top - sheetRect.top + (enRect.height / 2) - 12;
                top = Math.max(0, top);
                while (placedTops.some(t => Math.abs(t - top) < 24)) {
                    top += 24;
                }
                placedTops.push(top);

                const badge = document.createElement('div');
                badge.className = `topic-gutter-badge ${type === 'needs-sync' ? 'is-en-warn' : 'is-en-ok'} print-hide`;
                badge.setAttribute('data-html2canvas-ignore', 'true');
                badge.style.top = `${Math.round(top)}px`;
                badge.title = type === 'needs-sync' ? `点击定位到待核对的英文内容（${label || '正文'}，悬停查看对比）` : `点击定位到已同步的英文内容（${label || '正文'}，悬停查看对比）`;

                attachDiffPopoverListeners(badge, () => ({
                    isModified: true,
                    isSynced: type === 'synced',
                    cnEl,
                    enEl,
                    beforeHtml: item.beforeHtml,
                    afterHtml: item.afterHtml,
                    afterPlain: (cnEl && cnEl.textContent) ? cnEl.textContent.trim() : ''
                }));

                if (type === 'needs-sync') {
                    const isAiConnected = state.isAiConnected === true;
                    badge.innerHTML = `<span>⚠️ 待同步</span> <button type="button" class="topic-ai-translate-btn topic-ai-translate-mini-btn${isAiConnected ? '' : ' is-disabled'}" ${isAiConnected ? '' : 'disabled'} title="${isAiConnected ? `点击通过 AI 翻译并同步此项（${label || '正文'}）` : '未对接 AI 助手，请配置 API Token'}">${isAiConnected ? '✨ 翻译' : '✨ 禁用'}</button>`;
                    badge.addEventListener('click', event => {
                        const transBtn = event.target.closest('.topic-ai-translate-btn');
                        if (transBtn) {
                            event.stopPropagation();
                            if (isAiConnected) {
                                performAiTranslate(cnEl, enEl, transBtn);
                            }
                            return;
                        }
                        enEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        enEl.focus();
                    });
                } else {
                    badge.innerHTML = '<span>✓ 英文已改</span>';
                    badge.addEventListener('click', () => {
                        enEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        enEl.focus();
                    });
                }
                gutter.appendChild(badge);
            }
        });
    }

    function updateSyncCapsule(modifiedItems) {
        const capsule = elements?.eosSyncCapsule || (typeof document !== 'undefined' ? document.getElementById('eosSyncCapsule') : null);
        if (!capsule) return;
        if (!modifiedItems || !modifiedItems.length) {
            capsule.hidden = true;
            return;
        }
        const total = modifiedItems.length;
        const pending = modifiedItems.filter(i => i.type === 'needs-sync').length;
        if (pending > 0) {
            const isAiConnected = state.isAiConnected === true;
            capsule.className = 'topic-sync-capsule has-pending';
            capsule.innerHTML = `<span>📝 ${total} 处修改</span> · <span style="color:#b45309;font-weight:700;">⚠️ ${pending} 处待同步英文</span> <button type="button" class="topic-ai-translate-btn topic-ai-translate-mini-btn${isAiConnected ? '' : ' is-disabled'}" ${isAiConnected ? '' : 'disabled'} title="${isAiConnected ? '点击使用 AI 助手一键同步翻译所有待同步英文内容' : '未在全局配置中对接 AI 助手，请配置 API Token'}">${isAiConnected ? '✨ 全部 AI 翻译' : '✨ AI 未对接'}</button>`;
            capsule.onclick = event => {
                const btn = event.target.closest('.topic-ai-translate-btn');
                if (btn) {
                    event.stopPropagation();
                    if (isAiConnected) {
                        performAiTranslateAll(modifiedItems.filter(i => i.type === 'needs-sync'), btn);
                    }
                    return;
                }
                const firstPending = modifiedItems.find(i => i.type === 'needs-sync');
                if (firstPending && firstPending.enEl) {
                    firstPending.enEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    firstPending.enEl.focus();
                }
            };
        } else {
            capsule.className = 'topic-sync-capsule';
            capsule.innerHTML = `<span>📝 ${total} 处修改</span> · <span style="color:#047857;font-weight:700;">✓ 英文全部已同步</span>`;
            capsule.title = `共有 ${total} 处内容被修改，中英文均已完成同步。`;
            capsule.onclick = null;
        }
        capsule.hidden = false;
    }

    function updateBilingualSyncStatus() {
        const sheet = elements?.eosReportSheet || (typeof document !== 'undefined' ? document.getElementById('eosReportSheet') : null);
        if (!sheet) return;

        sheet.querySelectorAll('.topic-sync-chip').forEach(chip => chip.remove());
        sheet.querySelectorAll('.topic-block-modified').forEach(el => el.classList.remove('topic-block-modified'));
        sheet.querySelectorAll('.topic-en-needs-sync').forEach(el => el.classList.remove('topic-en-needs-sync'));
        sheet.querySelectorAll('.topic-en-synced').forEach(el => el.classList.remove('topic-en-synced'));

        const modifiedItems = [];
        const cnBlocks = sheet.querySelectorAll('[data-eos-copy-scope="monthly"], [data-eos-copy-scope="fixed"]');

        cnBlocks.forEach(cnEl => {
            const scope = cnEl.dataset.eosCopyScope;
            if (state.monthlyTopicKey && state.monthlyTopicKey !== 'eos' && scope === 'fixed') return;
            const key = cnEl.dataset.eosCopyKey;
            const defaultKey = `${scope}-${key}`;
            const defaultHtml = (state.copyDefaults.get(defaultKey) || '').trim();
            const currentHtml = sanitizeCopyHtml(cnEl.innerHTML).trim();

            const syncedMap = readSyncedCnPreferences(scope);
            const syncedHtml = (syncedMap[key] || '').trim();

            // Chinese is modified if:
            // 1. Different from template (defaultHtml)
            // 2. OR different from last synced Chinese (syncedHtml)
            const isDiffFromTemplate = Boolean(defaultHtml && currentHtml !== defaultHtml);
            const isDiffFromLastSync = Boolean(syncedHtml && currentHtml !== syncedHtml);
            const isCnModified = isDiffFromTemplate || isDiffFromLastSync;

            if (isCnModified) {
                cnEl.classList.add('topic-block-modified');
                const enScope = `${scope}-en`;
                const enEl = sheet.querySelector(`[data-eos-copy-scope="${enScope}"][data-eos-copy-key="${key}"]`);

                if (enEl) {
                    const enDefaultKey = `${enScope}-${key}`;
                    const enDefaultHtml = (state.copyDefaults.get(enDefaultKey) || '').trim();
                    const enCurrentHtml = sanitizeCopyHtml(enEl.innerHTML).trim();

                    // Baseline for comparison in popover:
                    const beforeHtml = syncedHtml || defaultHtml;
                    const afterHtml = currentHtml;

                    // English is in sync if syncedHtml equals currentHtml AND Chinese was modified from template
                    const isEnSynced = Boolean(syncedHtml && currentHtml === syncedHtml && isDiffFromTemplate);

                    const getPopoverContext = () => ({
                        isModified: true,
                        isSynced: isEnSynced,
                        cnEl,
                        enEl,
                        beforeHtml,
                        afterHtml,
                        afterPlain: cnEl.textContent ? cnEl.textContent.trim() : ''
                    });

                    attachDiffPopoverListeners(enEl, getPopoverContext);

                    if (isEnSynced) {
                        enEl.classList.add('topic-en-synced');
                        if (enEl.tagName !== 'TD' && enEl.tagName !== 'TH') {
                            const chip = document.createElement('div');
                            chip.className = 'topic-sync-chip topic-sync-chip-synced print-hide';
                            chip.setAttribute('data-html2canvas-ignore', 'true');
                            chip.setAttribute('contenteditable', 'false');
                            chip.innerHTML = '<span>✓ 英文已同步修改</span>';
                            attachDiffPopoverListeners(chip, getPopoverContext);
                            enEl.parentElement.insertBefore(chip, enEl);
                        } else {
                            enEl.title = '✓ 英文已同步修改（对应中文已改，悬停可查看对比）';
                        }
                        modifiedItems.push({ type: 'synced', cnEl, enEl, key, label: getBlockLabel(cnEl), beforeHtml, afterHtml });
                    } else {
                        enEl.classList.add('topic-en-needs-sync');
                        const isAiConnected = state.isAiConnected === true;
                        const aiBtnTitle = isAiConnected
                            ? '基于已修改的中文内容，通过 AI 助手专业翻译并同步英文（自动保全粗体和颜色格式）'
                            : '未在全局配置中对接 AI 助手 API Token（灰色显示），请在导航栏「设置 > AI 助手」中配置';

                        if (enEl.tagName !== 'TD' && enEl.tagName !== 'TH') {
                            const chip = document.createElement('div');
                            chip.className = 'topic-sync-chip topic-sync-chip-warn print-hide';
                            chip.setAttribute('data-html2canvas-ignore', 'true');
                            chip.setAttribute('contenteditable', 'false');

                            const warnSpan = document.createElement('span');
                            warnSpan.textContent = '⚠️ 对应中文已修改，建议同步修改英文';
                            chip.appendChild(warnSpan);

                            const aiBtn = document.createElement('button');
                            aiBtn.type = 'button';
                            aiBtn.className = `topic-ai-translate-btn${isAiConnected ? '' : ' is-disabled'}`;
                            aiBtn.disabled = !isAiConnected;
                            aiBtn.title = aiBtnTitle;
                            aiBtn.innerHTML = isAiConnected ? '✨ AI 翻译' : '✨ AI 翻译 (未对接AI)';
                            aiBtn.addEventListener('click', event => {
                                event.stopPropagation();
                                hideDiffPopover(true);
                                performAiTranslate(cnEl, enEl, aiBtn);
                            });
                            chip.appendChild(aiBtn);

                            attachDiffPopoverListeners(chip, getPopoverContext);
                            enEl.parentElement.insertBefore(chip, enEl);
                        } else {
                            enEl.title = isAiConnected
                                ? '⚠️ 对应中文表格内容已修改，可点击外侧翻译按钮或悬停查看修改对比'
                                : '⚠️ 对应中文表格内容已修改，建议同步核对修改英文（AI 未对接）';
                        }
                        modifiedItems.push({ type: 'needs-sync', cnEl, enEl, key, label: getBlockLabel(cnEl), beforeHtml, afterHtml });
                    }
                } else {
                    modifiedItems.push({ type: 'cn-only', cnEl, enEl: null, key, label: getBlockLabel(cnEl), beforeHtml: defaultHtml, afterHtml: currentHtml });
                }
            } else {
                const enScope = `${scope}-en`;
                const enEl = sheet.querySelector(`[data-eos-copy-scope="${enScope}"][data-eos-copy-key="${key}"]`);
                if (enEl) enEl._getDiffPopoverContext = null;
            }
        });

        renderGutterBadges(modifiedItems);
        updateSyncCapsule(modifiedItems);
    }

    function hideTextToolbar() { elements.eosTextToolbar.hidden = true; editingBlock = null; editingRange = null; }

    function updateToolbarActiveStates() {
        if (!elements.eosTextToolbar || elements.eosTextToolbar.hidden) return;
        const boldBtn = elements.eosTextToolbar.querySelector('button[data-eos-format="bold"]');
        let isBold = false;
        try {
            isBold = document.queryCommandState('bold');
        } catch (_) {}
        if (!isBold && editingRange) {
            const container = editingRange.commonAncestorContainer;
            const el = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
            if (el) {
                const weight = window.getComputedStyle(el).fontWeight;
                isBold = el.closest('strong, b') !== null || Number.parseInt(weight, 10) >= 600 || weight === 'bold';
            }
        }
        if (boldBtn) {
            boldBtn.classList.toggle('is-active', Boolean(isBold));
            boldBtn.setAttribute('aria-pressed', Boolean(isBold) ? 'true' : 'false');
            boldBtn.title = isBold ? '已加粗（点击取消加粗）' : '加粗';
        }

        let currentColor = '';
        try {
            currentColor = document.queryCommandValue('foreColor') || '';
        } catch (_) {}
        if (!currentColor && editingRange) {
            const container = editingRange.commonAncestorContainer;
            const el = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
            if (el) currentColor = window.getComputedStyle(el).color;
        }
        const hex = excelReportColor(currentColor, '').toLowerCase();
        elements.eosTextToolbar.querySelectorAll('button[data-eos-color]').forEach(btn => {
            const btnColor = btn.dataset.eosColor.toLowerCase();
            const btnHex = excelReportColor(btnColor, '').toLowerCase();
            const matches = hex && btnHex && hex === btnHex;
            btn.classList.toggle('is-active', Boolean(matches));
        });
    }

    function rememberTextSelection() {
        const selection = window.getSelection();
        if (!selection?.rangeCount || selection.isCollapsed) { hideTextToolbar(); return; }
        const anchor = selection.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode?.parentElement;
        const focus = selection.focusNode?.nodeType === Node.ELEMENT_NODE ? selection.focusNode : selection.focusNode?.parentElement;
        const block = anchor?.closest?.('.topic-report-sheet .topic-editable');
        if (!block || focus?.closest?.('.topic-report-sheet .topic-editable') !== block) { hideTextToolbar(); return; }
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (!rect.width && !rect.height) { hideTextToolbar(); return; }
        editingBlock = block; editingRange = range.cloneRange();
        elements.eosTextToolbar.hidden = false;
        elements.eosTextToolbar.style.top = `${Math.max(8, rect.top - elements.eosTextToolbar.offsetHeight - 8)}px`;
        elements.eosTextToolbar.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - elements.eosTextToolbar.offsetWidth - 8))}px`;
        updateToolbarActiveStates();
    }

    function applyTextFormat(command, value) {
        if (!editingBlock?.isConnected || !editingRange || editingRange.collapsed) return;
        editingBlock.focus();
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(editingRange);
        if (command === 'foreColor') document.execCommand('styleWithCSS', false, true);
        document.execCommand(command, false, value || null);
        saveCopy(editingBlock);
        updateBilingualSyncStatus();
        rememberTextSelection();
    }

    const THEME_STORAGE_KEY = 'topic_analysis_theme';

    function initTheme() {
        let saved = 'light';
        try { saved = localStorage.getItem(THEME_STORAGE_KEY) || 'light'; } catch (_) {}
        setTheme(saved, false);
    }

    function setTheme(theme, save = true) {
        const active = theme === 'dark' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', active);
        if (elements.themeToggleIcon && elements.themeToggleText && elements.themeToggleButton) {
            if (active === 'dark') {
                elements.themeToggleIcon.textContent = '🌙';
                elements.themeToggleText.textContent = '深色模式';
                elements.themeToggleButton.title = '当前为深色模式，点击切换至浅色模式';
            } else {
                elements.themeToggleIcon.textContent = '☀️';
                elements.themeToggleText.textContent = '浅色模式';
                elements.themeToggleButton.title = '当前为浅色模式，点击切换至深色模式';
            }
        }
        if (save) {
            try { localStorage.setItem(THEME_STORAGE_KEY, active); } catch (_) {}
        }
    }

    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        setTheme(current === 'dark' ? 'light' : 'dark', true);
    }

    const firstNumber = (row, keys) => {
        for (const key of keys) {
            const val = row?.[key];
            if (val !== undefined && val !== null && val !== '') {
                const n = Number(val);
                if (!Number.isNaN(n)) return n;
            }
        }
        return 0;
    };

    const customerName = row => mapCustomerName(row?.customer_name);

    function excelReportColor(value, fallback = 'FF0F172A') {
        const color = String(value || '').trim();
        const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
        if (hex) {
            const digits = hex[1].length === 3 ? [...hex[1]].map(letter => letter + letter).join('') : hex[1];
            return (digits.length === 8 ? digits : `FF${digits}`).toUpperCase();
        }
        const rgb = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        if (rgb) return `FF${rgb.slice(1, 4).map(part => Math.min(255, Number(part)).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
        return fallback;
    }

    function reportExcelRichText(block) {
        const computed = typeof getComputedStyle === 'function' ? getComputedStyle(block) : { fontWeight: '400', color: '#000000', fontSize: '14px' };
        const base = { bold: Number.parseInt(computed.fontWeight || '400', 10) >= 600, color: computed.color || '#000000' };
        const size = Math.max(9, Math.round(Number.parseFloat(computed.fontSize || '14') * 0.75));
        const runs = [];
        const visit = (node, format) => {
            if (node.nodeType === Node.TEXT_NODE) {
                if (node.textContent) runs.push({ text: node.textContent, font: { name: 'Microsoft YaHei', size, bold: format.bold, color: { argb: excelReportColor(format.color) } } });
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            const tag = node.tagName.toLowerCase();
            if (tag === 'br') { runs.push({ text: '\n', font: { name: 'Microsoft YaHei', size } }); return; }
            const next = { ...format };
            if (tag === 'b' || tag === 'strong') next.bold = true;
            if (node.style?.color) next.color = node.style.color;
            if (tag === 'font' && node.getAttribute('color')) next.color = node.getAttribute('color');
            Array.from(node.childNodes).forEach(child => visit(child, next));
            if (tag === 'div' || tag === 'p') runs.push({ text: '\n', font: { name: 'Microsoft YaHei', size } });
        };
        Array.from(block.childNodes).forEach(node => visit(node, base));
        return runs.length ? { richText: runs } : block.textContent;
    }

    async function downloadExcelWorkbook(workbook, filename) {
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function appendMonthlyWorksheet(workbook) {
        const sheet = elements.eosReportSheet || document.getElementById('eosReportSheet');
        if (!sheet) return;
        const worksheet = workbook.addWorksheet('EOS收编进展月报', {
            pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
        });
        const columns = 12;
        for (let c = 1; c <= columns; c++) worksheet.getColumn(c).width = c === 1 ? 16 : 12;
        const border = {
            top: { style: 'thin', color: { argb: 'FF94A3B8' } },
            left: { style: 'thin', color: { argb: 'FF94A3B8' } },
            bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
            right: { style: 'thin', color: { argb: 'FF94A3B8' } }
        };
        let rowNumber = 1;

        const appendCopy = block => {
            const row = worksheet.getRow(rowNumber++);
            worksheet.mergeCells(row.number, 1, row.number, columns);
            const cell = row.getCell(1);
            const computed = getComputedStyle(block);
            cell.value = reportExcelRichText(block);
            const isTitle = block.classList.contains('topic-report-title');
            const isSignature = block.classList.contains('topic-report-signature');
            const isSectionBar = block.classList.contains('topic-report-section-bar');
            const isEndmark = block.classList.contains('topic-report-endmark');
            const isDivider = block.classList.contains('topic-report-divider-badge') || block.classList.contains('topic-report-divider-en');
            const isSectionHeading = block.tagName === 'H3' || block.classList.contains('topic-report-heading') || block.tagName === 'H4' || block.classList.contains('topic-report-item-title') || block.classList.contains('topic-report-remarks-title');
            const isObjective = block.classList.contains('topic-report-objective') || block.parentElement?.classList.contains('topic-report-objective');
            cell.alignment = {
                vertical: 'middle',
                horizontal: isTitle || isSignature || isSectionBar || isEndmark || isDivider ? 'center' : 'left',
                wrapText: true
            };
            cell.font = {
                name: 'Microsoft YaHei',
                size: Math.max(9, Math.round(Number.parseFloat(computed.fontSize) * 0.75)),
                bold: Number.parseInt(computed.fontWeight, 10) >= 600 || isDivider,
                color: { argb: excelReportColor(computed.color) }
            };
            if (isTitle || isSignature) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCEEF4' } };
                row.height = 36;
            } else if (isDivider) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
                row.height = 28;
            } else if (isSectionBar) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
                row.height = 26;
            } else if (isEndmark) {
                row.height = 20;
            } else if (isSectionHeading) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
                row.height = 25;
                cell.border = { bottom: border.bottom };
            } else if (isObjective) {
                row.height = 22;
            } else {
                row.height = Math.max(20, Math.ceil(block.getBoundingClientRect().height * 0.75) + 3);
            }
        };

        const appendCaption = block => {
            const row = worksheet.getRow(rowNumber++);
            worksheet.mergeCells(row.number, 1, row.number, columns);
            const cell = row.getCell(1);
            cell.value = block.textContent.trim();
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.font = { name: 'Microsoft YaHei', size: 9, color: { argb: 'FF64748B' } };
            row.height = 20;
        };

        const appendTable = table => {
            const rows = Array.from(table.rows);
            const grid = [];
            rows.forEach((sourceRow, rowIndex) => {
                grid[rowIndex] = grid[rowIndex] || [];
                let cIndex = 1;
                const currentRow = worksheet.getRow(rowNumber);
                const isHeader = sourceRow.parentElement?.tagName === 'THEAD';
                const isTotal = sourceRow.classList.contains('topic-monthly-total');
                Array.from(sourceRow.cells).forEach(cell => {
                    while (grid[rowIndex][cIndex]) cIndex++;
                    const rowSpan = cell.rowSpan || 1;
                    const colSpan = cell.colSpan || 1;
                    if (rowSpan > 1 || colSpan > 1) {
                        worksheet.mergeCells(rowNumber, cIndex, rowNumber + rowSpan - 1, cIndex + colSpan - 1);
                    }
                    for (let r = 0; r < rowSpan; r++) {
                        grid[rowIndex + r] = grid[rowIndex + r] || [];
                        for (let c = 0; c < colSpan; c++) {
                            grid[rowIndex + r][cIndex + c] = true;
                        }
                    }
                    const xlCell = currentRow.getCell(cIndex);
                    const text = cell.textContent.trim();
                    const isPercent = /^[\d.]+%$/.test(text);
                    const isNumeric = /^-?\d+(?:,\d+)*(?:\.\d+)?$/.test(text);
                    const hasRichFormat = typeof cell.querySelector === 'function' && cell.querySelector('strong, b, span[style*="color"], font[color]');
                    if (hasRichFormat && typeof reportExcelRichText === 'function') {
                        xlCell.value = reportExcelRichText(cell);
                    } else {
                        xlCell.value = isPercent ? text : (isNumeric ? Number(text.replace(/,/g, '')) : text);
                    }
                    const isComplete = cell.classList.contains('topic-fixed-complete');
                    xlCell.font = {
                        name: 'Microsoft YaHei',
                        size: isHeader ? 10 : 9,
                        bold: isHeader || isTotal || cell.tagName === 'TH' || isComplete,
                        color: { argb: isComplete ? 'FF087443' : 'FF0F172A' }
                    };
                    xlCell.alignment = {
                        horizontal: cell.tagName === 'TH' && !cell.getAttribute('scope') ? 'center' : (isNumeric || isPercent ? 'right' : 'center'),
                        vertical: 'middle',
                        wrapText: true
                    };
                    xlCell.border = border;
                    if (isHeader || isTotal) {
                        xlCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F1F5' } };
                    }
                    cIndex += colSpan;
                });
                currentRow.height = isHeader ? 26 : 22;
                rowNumber++;
            });
            rowNumber++;
        };

        const appendNode = node => {
            if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
            if (node.hidden) return;
            if (node.classList?.contains('topic-report-gutter') || node.classList?.contains('topic-sync-chip') || node.hasAttribute?.('data-html2canvas-ignore')) {
                return;
            }
            if (node.classList?.contains('topic-monthly-source')) {
                if (node.classList.contains('is-hidden') || node.style?.display === 'none') {
                    return;
                }
            }
            if (node.classList?.contains('topic-report-caption')) {
                appendCaption(node);
            } else if (node.tagName === 'TABLE') {
                appendTable(node);
            } else if (
                node.classList?.contains('topic-report-title') ||
                node.classList?.contains('topic-report-signature') ||
                node.classList?.contains('topic-report-section-bar') ||
                node.classList?.contains('topic-report-item-title') ||
                node.classList?.contains('topic-report-objective') ||
                node.classList?.contains('topic-report-heading') ||
                node.classList?.contains('topic-report-remarks-title') ||
                node.classList?.contains('topic-monthly-intro') ||
                node.classList?.contains('topic-monthly-source') ||
                node.classList?.contains('topic-fixed-steps') ||
                node.classList?.contains('topic-fixed-footnote') ||
                node.classList?.contains('topic-report-footer-copy') ||
                node.classList?.contains('topic-report-contact-copy') ||
                node.classList?.contains('topic-report-endmark') ||
                node.classList?.contains('topic-monthly-footnote') ||
                node.classList?.contains('topic-report-divider-badge') ||
                (node.parentElement?.classList?.contains('topic-monthly-copy') && node.tagName === 'P') ||
                (node.parentElement?.classList?.contains('topic-report-objective') && node.tagName === 'P') ||
                (node.tagName === 'H3' && node.closest('.topic-report-sheet')) ||
                (node.tagName === 'H4' && node.closest('.topic-report-sheet'))
            ) {
                appendCopy(node);
            } else {
                Array.from(node.children || []).forEach(appendNode);
            }
        };

        Array.from(sheet.children).forEach(appendNode);
        worksheet.pageSetup.printArea = `A1:L${Math.max(1, rowNumber - 1)}`;
        return worksheet;
    }

    function appendAnalysisWorksheet(workbook, snapshot) {
        const worksheet = workbook.addWorksheet('多维度统计分析', {
            views: [{ state: 'frozen', ySplit: 1 }]
        });
        const borderThin = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };
        const borderHeader = {
            top: { style: 'thin', color: { argb: 'FF94A3B8' } },
            left: { style: 'thin', color: { argb: 'FF94A3B8' } },
            bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
            right: { style: 'thin', color: { argb: 'FF94A3B8' } }
        };

        const prodRows = Array.isArray(snapshot?.data?.eosProduct) ? snapshot.data.eosProduct : [];
        const verRows = Array.isArray(snapshot?.data?.eosVersion) ? snapshot.data.eosVersion : [];
        const plans = snapshot?.settings?.eos?.plans || {};

        const parseProdRow = row => {
            const cust = customerName(row);
            const line = String(row.product_line_name || row.product_line_map || '其他');
            const prod = String(row.product_name || '未命名产品');
            const phase = String(row.current_phase_name || '未指定');
            const qty = firstNumber(row, ['incorporation_total_nes', 'annual_storage', 'capacities', 'current_inventory']);
            const normal = firstNumber(row, ['before_urgent_incorporated_nes_dtl', 'incorporated_nes']);
            const deact = firstNumber(row, ['deactivated_nes']);
            const inc = qty > 0 ? Math.min(qty, normal + deact) : normal;
            const pend = firstNumber(row, ['to_be_incorporated_nes']);
            const planKey = [cust, line, prod, prod].join('|||');
            const plan = Math.min(pend, Math.max(0, Math.floor(Number(plans?.product?.[planKey]) || 0)));
            const noplan = Math.max(0, pend - plan);
            return { customer: cust, line, product: prod, phase, quantity: qty, incorporated: inc, pending: pend, deactivated: deact, annualPlan: plan, noPlan: noplan };
        };

        const parseVerRow = row => {
            const cust = customerName(row);
            const line = String(row.product_line_name || row.product_line_map || '其他');
            const prod = String(row.product_name || '未命名产品');
            const ver = String(row.software_version || row.version_name || prod);
            const phase = String(row.current_phase_name || '未指定');
            const qty = firstNumber(row, ['incorporation_total_nes', 'annual_storage', 'capacities', 'current_inventory']);
            const normal = firstNumber(row, ['nc_urgent_incorp_complet_rate_dtl', 'incorporated_nes']);
            const deact = firstNumber(row, ['deactivated_nes']);
            const inc = qty > 0 ? Math.min(qty, normal + deact) : normal;
            const pend = firstNumber(row, ['to_be_incorporated_nes']);
            const planKey = [cust, line, prod, ver].join('|||');
            const plan = Math.min(pend, Math.max(0, Math.floor(Number(plans?.version?.[planKey]) || 0)));
            const noplan = Math.max(0, pend - plan);
            return { customer: cust, line, product: prod, version: ver, phase, quantity: qty, incorporated: inc, pending: pend, deactivated: deact, annualPlan: plan, noPlan: noplan };
        };

        const parsedProds = prodRows.map(parseProdRow);
        const parsedVers = verRows.map(parseVerRow);

        let rowNum = 1;

        const writeSectionTitle = (title, cols) => {
            const row = worksheet.getRow(rowNum);
            worksheet.mergeCells(rowNum, 1, rowNum, cols);
            row.height = 26;
            const cell = row.getCell(1);
            cell.value = title;
            cell.font = { name: 'Microsoft YaHei', size: 11, bold: true, color: { argb: 'FF1D4ED8' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
            cell.alignment = { vertical: 'middle', horizontal: 'left' };
            cell.border = { bottom: { style: 'thin', color: { argb: 'FF93C5FD' } } };
            rowNum++;
        };

        const writeHeaders = (headers, colWidths = []) => {
            const row = worksheet.getRow(rowNum);
            row.height = 24;
            headers.forEach((h, idx) => {
                const c = row.getCell(idx + 1);
                c.value = h;
                c.font = { name: 'Microsoft YaHei', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
                c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
                c.alignment = { vertical: 'middle', horizontal: 'center' };
                c.border = borderHeader;
                if (colWidths[idx]) {
                    const col = worksheet.getColumn(idx + 1);
                    col.width = Math.max(col.width || 0, colWidths[idx]);
                }
            });
            rowNum++;
        };

        const writeDataRow = (values, alignMap = [], isTotal = false) => {
            const row = worksheet.getRow(rowNum);
            row.height = isTotal ? 23 : 21;
            values.forEach((v, idx) => {
                const c = row.getCell(idx + 1);
                c.value = v;
                c.font = { name: 'Microsoft YaHei', size: 9, bold: isTotal, color: { argb: 'FF0F172A' } };
                c.border = isTotal ? { top: { style: 'double', color: { argb: 'FF94A3B8' } }, bottom: { style: 'thin', color: { argb: 'FF94A3B8' } } } : borderThin;
                if (isTotal) {
                    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
                }
                const align = alignMap[idx] || (typeof v === 'number' ? 'right' : 'center');
                c.alignment = { vertical: 'middle', horizontal: align };
            });
            rowNum++;
        };

        // Table 1: 产品收编 · 分客户与产品线分析
        writeSectionTitle('表 1：产品收编 · 分客户与产品线多维分析', 11);
        const t1Headers = ['序号', '客户', '产品线', '产品种类数', '网元总量', '已收编网元', '当前收编率', '待收编网元', '今年计划', '无计划', '计划后收编率'];
        const t1Widths = [8, 16, 16, 12, 12, 12, 13, 12, 12, 12, 13];
        writeHeaders(t1Headers, t1Widths);

        const prodCustLineMap = new Map();
        parsedProds.forEach(p => {
            const k = `${p.customer}|||${p.line}`;
            if (!prodCustLineMap.has(k)) prodCustLineMap.set(k, { customer: p.customer, line: p.line, prods: new Set(), qty: 0, inc: 0, pend: 0, plan: 0, noplan: 0 });
            const item = prodCustLineMap.get(k);
            item.prods.add(p.product);
            item.qty += p.quantity;
            item.inc += p.incorporated;
            item.pend += p.pending;
            item.plan += p.annualPlan;
            item.noplan += p.noPlan;
        });

        const t1Items = [...prodCustLineMap.values()].sort((a, b) => a.customer.localeCompare(b.customer, 'zh-CN') || a.line.localeCompare(b.line, 'zh-CN'));
        const t1Total = { qty: 0, inc: 0, pend: 0, plan: 0, noplan: 0 };
        t1Items.forEach((item, idx) => {
            t1Total.qty += item.qty;
            t1Total.inc += item.inc;
            t1Total.pend += item.pend;
            t1Total.plan += item.plan;
            t1Total.noplan += item.noplan;
            const curRate = item.qty ? `${(item.inc / item.qty * 100).toFixed(1)}%` : '0.0%';
            const planRate = item.qty ? `${(Math.min(item.qty, item.inc + item.plan) / item.qty * 100).toFixed(1)}%` : '0.0%';
            writeDataRow([idx + 1, item.customer, item.line, item.prods.size, item.qty, item.inc, curRate, item.pend, item.plan, item.noplan, planRate],
                ['center', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right']);
        });
        const t1CurRate = t1Total.qty ? `${(t1Total.inc / t1Total.qty * 100).toFixed(1)}%` : '0.0%';
        const t1PlanRate = t1Total.qty ? `${(Math.min(t1Total.qty, t1Total.inc + t1Total.plan) / t1Total.qty * 100).toFixed(1)}%` : '0.0%';
        writeDataRow(['合计', '—', '—', new Set(parsedProds.map(p => p.product)).size, t1Total.qty, t1Total.inc, t1CurRate, t1Total.pend, t1Total.plan, t1Total.noplan, t1PlanRate],
            ['center', 'center', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'], true);
        rowNum++;

        // Table 2: 产品收编 · 重点待收编产品 TOP 10
        writeSectionTitle('表 2：产品收编 · 重点待收编产品排行 TOP 10', 10);
        const t2Headers = ['排名', '产品名称', '产品线', '涉及客户', '网元总量', '已收编网元', '待收编网元', '今年计划', '无计划', '当前收编率'];
        const t2Widths = [8, 22, 16, 20, 12, 12, 12, 12, 12, 13];
        writeHeaders(t2Headers, t2Widths);

        const prodMap = new Map();
        parsedProds.forEach(p => {
            if (!prodMap.has(p.product)) prodMap.set(p.product, { product: p.product, line: p.line, custs: new Set(), qty: 0, inc: 0, pend: 0, plan: 0, noplan: 0 });
            const item = prodMap.get(p.product);
            item.custs.add(p.customer);
            item.qty += p.quantity;
            item.inc += p.incorporated;
            item.pend += p.pending;
            item.plan += p.annualPlan;
            item.noplan += p.noPlan;
        });

        const t2Items = [...prodMap.values()].sort((a, b) => b.noplan - a.noplan || b.pend - a.pend).slice(0, 10);
        t2Items.forEach((item, idx) => {
            const curRate = item.qty ? `${(item.inc / item.qty * 100).toFixed(1)}%` : '0.0%';
            writeDataRow([idx + 1, item.product, item.line, [...item.custs].join('、'), item.qty, item.inc, item.pend, item.plan, item.noplan, curRate],
                ['center', 'left', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right']);
        });
        rowNum++;

        // Table 3: 版本收编 · 分客户与产品线分析
        writeSectionTitle('表 3：版本收编 · 分客户与产品线多维分析', 11);
        const t3Headers = ['序号', '客户', '产品线', '版本数量', '网元总量', '已收编网元', '当前收编率', '待收编网元', '今年计划', '无计划', '计划后收编率'];
        writeHeaders(t3Headers, t1Widths);

        const verCustLineMap = new Map();
        parsedVers.forEach(v => {
            const k = `${v.customer}|||${v.line}`;
            if (!verCustLineMap.has(k)) verCustLineMap.set(k, { customer: v.customer, line: v.line, vers: new Set(), qty: 0, inc: 0, pend: 0, plan: 0, noplan: 0 });
            const item = verCustLineMap.get(k);
            item.vers.add(v.version);
            item.qty += v.quantity;
            item.inc += v.incorporated;
            item.pend += v.pending;
            item.plan += v.annualPlan;
            item.noplan += v.noPlan;
        });

        const t3Items = [...verCustLineMap.values()].sort((a, b) => a.customer.localeCompare(b.customer, 'zh-CN') || a.line.localeCompare(b.line, 'zh-CN'));
        const t3Total = { qty: 0, inc: 0, pend: 0, plan: 0, noplan: 0 };
        t3Items.forEach((item, idx) => {
            t3Total.qty += item.qty;
            t3Total.inc += item.inc;
            t3Total.pend += item.pend;
            t3Total.plan += item.plan;
            t3Total.noplan += item.noplan;
            const curRate = item.qty ? `${(item.inc / item.qty * 100).toFixed(1)}%` : '0.0%';
            const planRate = item.qty ? `${(Math.min(item.qty, item.inc + item.plan) / item.qty * 100).toFixed(1)}%` : '0.0%';
            writeDataRow([idx + 1, item.customer, item.line, item.vers.size, item.qty, item.inc, curRate, item.pend, item.plan, item.noplan, planRate],
                ['center', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right']);
        });
        const t3CurRate = t3Total.qty ? `${(t3Total.inc / t3Total.qty * 100).toFixed(1)}%` : '0.0%';
        const t3PlanRate = t3Total.qty ? `${(Math.min(t3Total.qty, t3Total.inc + t3Total.plan) / t3Total.qty * 100).toFixed(1)}%` : '0.0%';
        writeDataRow(['合计', '—', '—', new Set(parsedVers.map(v => v.version)).size, t3Total.qty, t3Total.inc, t3CurRate, t3Total.pend, t3Total.plan, t3Total.noplan, t3PlanRate],
            ['center', 'center', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'], true);
        rowNum++;

        // Table 4: 版本收编 · 高风险无计划版本 TOP 10
        writeSectionTitle('表 4：版本收编 · 高风险无计划版本排行 TOP 10', 11);
        const t4Headers = ['排名', '软件版本', '所属产品', '产品线', '涉及客户', '网元总量', '已收编网元', '待收编网元', '今年计划', '无计划', '当前收编率'];
        const t4Widths = [8, 24, 20, 16, 18, 12, 12, 12, 12, 12, 13];
        writeHeaders(t4Headers, t4Widths);

        const verMap = new Map();
        parsedVers.forEach(v => {
            const k = `${v.product}|||${v.version}`;
            if (!verMap.has(k)) verMap.set(k, { version: v.version, product: v.product, line: v.line, custs: new Set(), qty: 0, inc: 0, pend: 0, plan: 0, noplan: 0 });
            const item = verMap.get(k);
            item.custs.add(v.customer);
            item.qty += v.quantity;
            item.inc += v.incorporated;
            item.pend += v.pending;
            item.plan += v.annualPlan;
            item.noplan += v.noPlan;
        });

        const t4Items = [...verMap.values()].sort((a, b) => b.noplan - a.noplan || b.pend - a.pend).slice(0, 10);
        t4Items.forEach((item, idx) => {
            const curRate = item.qty ? `${(item.inc / item.qty * 100).toFixed(1)}%` : '0.0%';
            writeDataRow([idx + 1, item.version, item.product, item.line, [...item.custs].join('、'), item.qty, item.inc, item.pend, item.plan, item.noplan, curRate],
                ['center', 'left', 'left', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right']);
        });
        rowNum++;

        // Table 5: 阶段分布统计
        writeSectionTitle('表 5：EOS 收编与处置阶段分布统计', 5);
        const t5Headers = ['处置阶段', '产品涉及网元', '产品网元占比', '版本涉及网元', '版本网元占比'];
        const t5Widths = [18, 14, 14, 14, 14];
        writeHeaders(t5Headers, t5Widths);

        const phases = new Set([...parsedProds.map(p => p.phase), ...parsedVers.map(v => v.phase)]);
        const totalP = parsedProds.reduce((s, p) => s + p.quantity, 0);
        const totalV = parsedVers.reduce((s, v) => s + v.quantity, 0);
        [...phases].forEach(ph => {
            const pQty = parsedProds.filter(p => p.phase === ph).reduce((s, p) => s + p.quantity, 0);
            const vQty = parsedVers.filter(v => v.phase === ph).reduce((s, v) => s + v.quantity, 0);
            const pPct = totalP ? `${(pQty / totalP * 100).toFixed(1)}%` : '0.0%';
            const vPct = totalV ? `${(vQty / totalV * 100).toFixed(1)}%` : '0.0%';
            writeDataRow([ph, pQty, pPct, vQty, vPct], ['left', 'right', 'right', 'right', 'right']);
        });
        writeDataRow(['合计', totalP, '100.0%', totalV, '100.0%'], ['center', 'right', 'right', 'right', 'right'], true);

        return worksheet;
    }

    function appendProductDetailWorksheet(workbook, snapshot) {
        const worksheet = workbook.addWorksheet('产品收编详表', {
            views: [{ state: 'frozen', ySplit: 1 }]
        });
        const headers = ['序号', '客户', '产品线', '产品名称', '当前阶段', '网元总量', '已收编网元', '待收编网元', '已退网网元', '今年计划', '无计划', '当前收编率', '计划后收编率'];
        const widths = [8, 16, 16, 22, 14, 12, 12, 12, 12, 12, 12, 13, 13];
        const borderHeader = {
            top: { style: 'thin', color: { argb: 'FF94A3B8' } },
            left: { style: 'thin', color: { argb: 'FF94A3B8' } },
            bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
            right: { style: 'thin', color: { argb: 'FF94A3B8' } }
        };
        const borderThin = {
            top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };

        const headRow = worksheet.getRow(1);
        headRow.height = 26;
        headers.forEach((h, idx) => {
            const cell = headRow.getCell(idx + 1);
            cell.value = h;
            cell.font = { name: 'Microsoft YaHei', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F1F5' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = borderHeader;
            worksheet.getColumn(idx + 1).width = widths[idx];
        });

        const rows = Array.isArray(snapshot?.data?.eosProduct) ? snapshot.data.eosProduct : [];
        const plans = snapshot?.settings?.eos?.plans || {};

        rows.forEach((r, idx) => {
            const cust = customerName(r);
            const line = String(r.product_line_name || r.product_line_map || '其他');
            const prod = String(r.product_name || '未命名产品');
            const phase = String(r.current_phase_name || '未指定');
            const qty = firstNumber(r, ['incorporation_total_nes', 'annual_storage', 'capacities', 'current_inventory']);
            const normal = firstNumber(r, ['before_urgent_incorporated_nes_dtl', 'incorporated_nes']);
            const deact = firstNumber(r, ['deactivated_nes']);
            const inc = qty > 0 ? Math.min(qty, normal + deact) : normal;
            const pend = firstNumber(r, ['to_be_incorporated_nes']);
            const planKey = [cust, line, prod, prod].join('|||');
            const plan = Math.min(pend, Math.max(0, Math.floor(Number(plans?.product?.[planKey]) || 0)));
            const noplan = Math.max(0, pend - plan);
            const curRate = qty ? `${(inc / qty * 100).toFixed(1)}%` : '0.0%';
            const planRate = qty ? `${(Math.min(qty, inc + plan) / qty * 100).toFixed(1)}%` : '0.0%';

            const row = worksheet.getRow(idx + 2);
            row.height = 21;
            const vals = [idx + 1, cust, line, prod, phase, qty, inc, pend, deact, plan, noplan, curRate, planRate];
            vals.forEach((v, cIdx) => {
                const cell = row.getCell(cIdx + 1);
                cell.value = v;
                cell.font = { name: 'Microsoft YaHei', size: 9, color: { argb: 'FF0F172A' } };
                cell.border = borderThin;
                cell.alignment = {
                    vertical: 'middle',
                    horizontal: [0, 1, 2, 3, 4].includes(cIdx) ? ([0].includes(cIdx) ? 'center' : 'left') : 'right'
                };
            });
        });

        worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
        return worksheet;
    }

    function appendVersionDetailWorksheet(workbook, snapshot) {
        const worksheet = workbook.addWorksheet('版本收编详表', {
            views: [{ state: 'frozen', ySplit: 1 }]
        });
        const headers = ['序号', '客户', '产品线', '产品名称', '软件版本', '当前阶段', '网元总量', '已收编网元', '待收编网元', '已退网网元', '今年计划', '无计划', '当前收编率', '计划后收编率'];
        const widths = [8, 16, 16, 20, 24, 14, 12, 12, 12, 12, 12, 12, 13, 13];
        const borderHeader = {
            top: { style: 'thin', color: { argb: 'FF94A3B8' } },
            left: { style: 'thin', color: { argb: 'FF94A3B8' } },
            bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
            right: { style: 'thin', color: { argb: 'FF94A3B8' } }
        };
        const borderThin = {
            top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };

        const headRow = worksheet.getRow(1);
        headRow.height = 26;
        headers.forEach((h, idx) => {
            const cell = headRow.getCell(idx + 1);
            cell.value = h;
            cell.font = { name: 'Microsoft YaHei', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F1F5' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = borderHeader;
            worksheet.getColumn(idx + 1).width = widths[idx];
        });

        const rows = Array.isArray(snapshot?.data?.eosVersion) ? snapshot.data.eosVersion : [];
        const plans = snapshot?.settings?.eos?.plans || {};

        rows.forEach((r, idx) => {
            const cust = customerName(r);
            const line = String(r.product_line_name || r.product_line_map || '其他');
            const prod = String(r.product_name || '未命名产品');
            const ver = String(r.software_version || r.version_name || prod);
            const phase = String(r.current_phase_name || '未指定');
            const qty = firstNumber(r, ['incorporation_total_nes', 'annual_storage', 'capacities', 'current_inventory']);
            const normal = firstNumber(r, ['nc_urgent_incorp_complet_rate_dtl', 'incorporated_nes']);
            const deact = firstNumber(r, ['deactivated_nes']);
            const inc = qty > 0 ? Math.min(qty, normal + deact) : normal;
            const pend = firstNumber(r, ['to_be_incorporated_nes']);
            const planKey = [cust, line, prod, ver].join('|||');
            const plan = Math.min(pend, Math.max(0, Math.floor(Number(plans?.version?.[planKey]) || 0)));
            const noplan = Math.max(0, pend - plan);
            const curRate = qty ? `${(inc / qty * 100).toFixed(1)}%` : '0.0%';
            const planRate = qty ? `${(Math.min(qty, inc + plan) / qty * 100).toFixed(1)}%` : '0.0%';

            const row = worksheet.getRow(idx + 2);
            row.height = 21;
            const vals = [idx + 1, cust, line, prod, ver, phase, qty, inc, pend, deact, plan, noplan, curRate, planRate];
            vals.forEach((v, cIdx) => {
                const cell = row.getCell(cIdx + 1);
                cell.value = v;
                cell.font = { name: 'Microsoft YaHei', size: 9, color: { argb: 'FF0F172A' } };
                cell.border = borderThin;
                cell.alignment = {
                    vertical: 'middle',
                    horizontal: [0, 1, 2, 3, 4, 5].includes(cIdx) ? ([0].includes(cIdx) ? 'center' : 'left') : 'right'
                };
            });
        });

        worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
        return worksheet;
    }

    function togglePngDropdown(force) {
        const menu = elements.eosPngMenu || document.getElementById('eosPngMenu');
        const btn = elements.eosDownloadPng || document.getElementById('eosDownloadPng');
        if (!menu) return;
        if (btn && btn.disabled) {
            menu.hidden = true;
            return;
        }
        const willOpen = typeof force === 'boolean' ? force : menu.hidden;
        menu.hidden = !willOpen;
    }

    function closePngDropdown() {
        const menu = elements.eosPngMenu || document.getElementById('eosPngMenu');
        if (menu) menu.hidden = true;
    }

    async function captureAndDownloadMonthlyPng(scope, button, month) {
        const sheet = elements.eosReportSheet || document.getElementById('eosReportSheet');
        if (!sheet) return;

        sheet.classList.remove('export-mode-cn', 'export-mode-en');
        let suffix = '';
        if (scope === 'cn') {
            sheet.classList.add('export-mode-cn');
            suffix = '_中文版';
        } else if (scope === 'en') {
            sheet.classList.add('export-mode-en');
            suffix = '_英文版';
        } else {
            suffix = '_中英文合一';
        }

        try {
            await new Promise(resolve => setTimeout(resolve, 60));
            const canvas = await html2canvas(sheet, {
                backgroundColor: '#ffffff',
                scale: 2,
                useCORS: true,
                logging: false,
                ignoreElements: el => el.hasAttribute && (
                    el.hasAttribute('data-html2canvas-ignore') ||
                    el.classList.contains('print-hide') ||
                    el.classList.contains('topic-sync-chip') ||
                    el.classList.contains('topic-cell-sync-chip') ||
                    el.classList.contains('topic-report-gutter') ||
                    el.classList.contains('topic-diff-popover') ||
                    el.classList.contains('topic-section-anchor')
                )
            });

            const link = document.createElement('a');
            link.download = isGenericMonthly() ? `${monthlyFilename()}_${month}${suffix}.png` : `埃及代表处EOS退网收编简报_${month}${suffix}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        } finally {
            sheet.classList.remove('export-mode-cn', 'export-mode-en');
        }
    }

    async function exportMonthlyPng(scope = 'both') {
        if (!state.eosMonthlyReport) {
            AppDialog.alert('当前暂无月报数据可供导出。', { title: '提示', tone: 'warning' });
            return;
        }
        if (typeof html2canvas !== 'function') {
            AppDialog.alert('图片导出组件（html2canvas）未加载，请刷新页面后重试。', { title: '提示', tone: 'warning' });
            return;
        }
        const sheet = elements.eosReportSheet || document.getElementById('eosReportSheet');
        if (!sheet) return;
        closePngDropdown();
        hideTextToolbar();
        hideDiffPopover(true);
        if (document.activeElement && document.activeElement.classList?.contains('topic-editable')) {
            document.activeElement.blur();
        }
        const button = elements.eosDownloadPng;
        const originalText = button ? button.textContent : '';
        if (button) {
            button.classList.add('is-loading');
        }

        const currentTheme = document.documentElement.getAttribute('data-theme');
        if (currentTheme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'light');
        }
        const month = state.eosMonthlyReport.month || '当期';

        try {
            if (scope === 'all-three') {
                if (button) button.textContent = '正在生成中文版 PNG...';
                await captureAndDownloadMonthlyPng('cn', button, month);
                await new Promise(r => setTimeout(r, 400));

                if (button) button.textContent = '正在生成英文版 PNG...';
                await captureAndDownloadMonthlyPng('en', button, month);
                await new Promise(r => setTimeout(r, 400));

                if (button) button.textContent = '正在生成合一版 PNG...';
                await captureAndDownloadMonthlyPng('both', button, month);

                setCopyStatus('3 张月报 PNG 图片已全部下载完成！');
            } else {
                const label = scope === 'cn' ? '中文版' : scope === 'en' ? '英文版' : '合一版';
                if (button) button.textContent = `正在生成${label} PNG...`;
                await captureAndDownloadMonthlyPng(scope, button, month);
                setCopyStatus(`月报 ${label} PNG 下载成功！`);
            }
        } catch (error) {
            console.error('月报 PNG 导出失败:', error);
            AppDialog.alert(`月报 PNG 导出失败：${error.message}`, { title: '月报 PNG 导出失败', tone: 'error' });
        } finally {
            if (currentTheme === 'dark') {
                document.documentElement.setAttribute('data-theme', 'dark');
            }
            if (button) {
                button.classList.remove('is-loading');
                button.textContent = originalText;
            }
        }
    }

    async function exportMonthlyPdf() {
        if (!state.eosMonthlyReport) {
            AppDialog.alert('当前暂无月报数据可供导出。', { title: '提示', tone: 'warning' });
            return;
        }
        if (typeof html2canvas !== 'function') {
            AppDialog.alert('图片转换依赖（html2canvas）未加载，请刷新页面后重试。', { title: '提示', tone: 'warning' });
            return;
        }
        const jsPdfConstructor = window.jspdf?.jsPDF || (typeof jsPDF === 'function' ? jsPDF : null);
        if (!jsPdfConstructor) {
            AppDialog.alert('PDF 导出依赖（jsPDF）未加载，请刷新页面后重试。', { title: '提示', tone: 'warning' });
            return;
        }
        const sheet = elements.eosReportSheet || document.getElementById('eosReportSheet');
        if (!sheet) return;
        closePngDropdown();
        hideTextToolbar();
        hideDiffPopover(true);
        if (document.activeElement && (document.activeElement.classList?.contains('topic-editable') || sheet.contains(document.activeElement))) {
            document.activeElement.blur();
        }
        const button = elements.eosDownloadPdf;
        const originalText = button ? button.textContent : '';
        if (button) {
            button.classList.add('is-loading');
            button.textContent = '正在生成 PDF...';
        }

        const currentTheme = document.documentElement.getAttribute('data-theme');
        if (currentTheme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'light');
        }
        try {
            await new Promise(resolve => setTimeout(resolve, 60));
            const canvas = await html2canvas(sheet, {
                backgroundColor: '#ffffff',
                scale: 2,
                useCORS: true,
                logging: false,
                ignoreElements: el => el.hasAttribute && (
                    el.hasAttribute('data-html2canvas-ignore') ||
                    el.classList.contains('print-hide') ||
                    el.classList.contains('topic-sync-chip') ||
                    el.classList.contains('topic-cell-sync-chip') ||
                    el.classList.contains('topic-report-gutter') ||
                    el.classList.contains('topic-diff-popover') ||
                    el.classList.contains('topic-section-anchor')
                )
            });

            const imgData = canvas.toDataURL('image/jpeg', 0.96);
            const pdfWidth = 595.28;
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
            const pdf = new jsPdfConstructor({
                orientation: 'p',
                unit: 'pt',
                format: [pdfWidth, pdfHeight],
                compress: true
            });
            pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);

            const month = state.eosMonthlyReport.month || '当期';
            const filename = isGenericMonthly() ? `${monthlyFilename()}_${month}.pdf` : `埃及代表处EOS退网收编简报_${month}.pdf`;
            pdf.save(filename);
            setCopyStatus('月报 PDF 导出成功！');
        } catch (error) {
            console.error('月报 PDF 导出失败:', error);
            AppDialog.alert(`月报 PDF 导出失败：${error.message}`, { title: '月报 PDF 导出失败', tone: 'error' });
        } finally {
            if (currentTheme === 'dark') {
                document.documentElement.setAttribute('data-theme', 'dark');
            }
            if (button) {
                button.classList.remove('is-loading');
                button.textContent = originalText;
            }
        }
    }

    async function exportMonthlyHtml() {
        if (!state.eosMonthlyReport) {
            AppDialog.alert('当前暂无月报数据可供导出。', { title: '提示', tone: 'warning' });
            return;
        }
        const sheet = elements.eosReportSheet || document.getElementById('eosReportSheet');
        if (!sheet) return;
        hideTextToolbar();
        hideDiffPopover(true);
        if (document.activeElement && document.activeElement.classList?.contains('topic-editable')) {
            document.activeElement.blur();
        }
        const button = elements.eosDownloadHtml;
        const originalText = button ? button.textContent : '';
        if (button) {
            button.classList.add('is-loading');
            button.textContent = '正在生成 HTML...';
        }
        try {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            let cleanDom;
            try {
                if (currentTheme === 'dark') document.documentElement.setAttribute('data-theme', 'light');
                cleanDom = window.ReportMsgExport?.copyForEmail ? window.ReportMsgExport.copyForEmail(sheet) : null;
            } finally {
                if (currentTheme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
            }
            if (!cleanDom) {
                throw new Error('未能提取月报排版内容');
            }

            const month = state.eosMonthlyReport.month || '当期';
            const htmlDocument = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(monthlyFilename())}（${escapeHtml(month)}）</title>
    <style>
        * { box-sizing: border-box; }
        body {
            margin: 0;
            padding: 28px 16px;
            background: #f1f5f9;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", Arial, sans-serif;
            color: #0f172a;
            line-height: 1.5;
            -webkit-font-smoothing: antialiased;
        }
        .topic-html-page {
            width: 96%;
            max-width: 1560px;
            min-width: 1050px;
            margin: 0 auto;
            background: #ffffff;
            padding: 36px 32px;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
            border: 1px solid #e2e8f0;
            box-sizing: border-box;
        }
        .topic-html-page .topic-report-sheet {
            max-width: none !important;
            width: 100% !important;
            border: none !important;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
            background: transparent !important;
        }
        table {
            border-collapse: collapse !important;
            width: 100% !important;
        }
        a {
            color: #1d4ed8;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        @media print {
            body {
                background: #ffffff !important;
                padding: 0 !important;
            }
            .topic-html-page {
                max-width: 100% !important;
                margin: 0 !important;
                padding: 0 !important;
                border: none !important;
                box-shadow: none !important;
            }
        }
    </style>
</head>
<body>
    <div class="topic-html-page">
        ${cleanDom.outerHTML}
    </div>
</body>
</html>`;

            const blob = new Blob([htmlDocument], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.download = isGenericMonthly() ? `${monthlyFilename()}_${month}.html` : `埃及代表处EOS退网收编简报_${month}.html`;
            link.href = url;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            setCopyStatus('月报 HTML 导出成功！');
        } catch (error) {
            console.error('月报 HTML 导出失败:', error);
            AppDialog.alert(`月报 HTML 导出失败：${error.message}`, { title: '月报 HTML 导出失败', tone: 'error' });
        } finally {
            if (button) {
                button.classList.remove('is-loading');
                button.textContent = originalText;
            }
        }
    }

    async function exportMonthlyExcel() {
        if (!state.eosMonthlyReport) {
            AppDialog.alert('当前暂无月报数据可供导出。', { title: '提示', tone: 'warning' });
            return;
        }
        if (typeof ExcelJS === 'undefined') {
            AppDialog.alert('Excel 导出组件（ExcelJS）未加载，请刷新页面后重试。', { title: '提示', tone: 'warning' });
            return;
        }
        const button = elements.eosDownloadExcel;
        const originalText = button.textContent;
        button.classList.add('is-loading');
        button.textContent = '正在生成 Excel...';
        try {
            const workbook = await buildMonthlyWorkbook();

            const month = state.eosMonthlyReport.month || '当期';
            await downloadExcelWorkbook(workbook, isGenericMonthly() ? `${monthlyFilename()}_${month}.xlsx` : `埃及代表处EOS退网收编简报_${month}.xlsx`);
        } catch (error) {
            console.error('月报 Excel 导出失败:', error);
            AppDialog.alert(`月报 Excel 导出失败：${error.message}`, { title: '月报 Excel 导出失败', tone: 'error' });
        } finally {
            button.classList.remove('is-loading');
            button.textContent = originalText;
        }
    }

    async function buildMonthlyWorkbook() {
        if (isGenericMonthly()) {
            const workbook = new ExcelJS.Workbook();
            workbook.creator = monthlyDefinition().en;
            workbook.created = new Date();
            appendMonthlyWorksheet(workbook);
            workbook.worksheets[0].name = '专题进展月报';
            appendGenericWorksheets(workbook, state.eosMonthlyReport);
            return workbook;
        }
        let snapshot = state.eosMonthlySnapshot;
        if (!snapshot && state.eosMonthlyReport?.snapshot?.id && state.eosMonthlyReport.snapshot.id !== 'default') {
            const item = await getFullSnapshot(state.eosMonthlyReport.snapshot.id);
            snapshot = item?.snapshot;
            state.eosMonthlySnapshot = snapshot;
        }
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'NetCare · EOS 进展月报';
        workbook.created = new Date();
        appendMonthlyWorksheet(workbook);
        appendAnalysisWorksheet(workbook, snapshot);
        appendProductDetailWorksheet(workbook, snapshot);
        appendVersionDetailWorksheet(workbook, snapshot);
        return workbook;
    }

    async function exportMonthlyMsg() {
        if (!state.eosMonthlyReport) { AppDialog.alert('当前暂无月报数据可供导出。', { title: '提示', tone: 'warning' }); return; }
        const button = elements.eosDownloadMsg;
        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = '正在生成 MSG...';
        try {
            const month = state.eosMonthlyReport.month || '当期';
            const workbook = await buildMonthlyWorkbook();
            const bytes = await workbook.xlsx.writeBuffer();
            await window.ReportMsgExport.download(elements.eosReportSheet,
                `${monthlyFilename()}（${month}）`, `${monthlyFilename()}_${month}.msg`,
                { filename: `${monthlyFilename()}_${month}.xlsx`, bytes });
        } catch (error) {
            console.error('月报 MSG 导出失败:', error);
            window.ReportMsgExport.showError(error);
        } finally {
            button.disabled = false;
            button.textContent = originalText;
        }
    }

    function buildProjectObject() {
        if (!state.eosMonthlyReport) return null;
        const report = state.eosMonthlyReport;
        const month = report.month || '当月';
        const project = {
            fileType: 'topic-eos-monthly-project',
            topicKey: state.monthlyTopicKey,
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            month: month,
            sourceTimeHidden: elements.eosMonthlySource ? elements.eosMonthlySource.classList.contains('is-hidden') : false,
            customerMappingConfig: readMappingConfig(),
            reportData: report,
            snapshot: state.eosMonthlySnapshot || report.snapshot || null,
            copyPreferences: {
                monthly: readCopyPreferences('monthly'),
                monthlyEn: readCopyPreferences('monthly-en'),
                fixed: readCopyPreferences('fixed'),
                fixedEn: readCopyPreferences('fixed-en')
            },
            syncedCnPreferences: {
                monthly: readSyncedCnPreferences('monthly'),
                fixed: readSyncedCnPreferences('fixed')
            },
            preTranslatePreferences: { monthlyEn: readPreTranslatePreferences('monthly-en'), fixedEn: readPreTranslatePreferences('fixed-en') }
        };
        if (isGenericMonthly()) project.fileType = 'topic-monthly-project';
        return project;
    }

    async function exportProjectFile() {
        if (!state.eosMonthlyReport) {
            AppDialog.alert('当前没有可导出的月报数据。', { title: '提示', tone: 'warning' });
            return;
        }
        const report = state.eosMonthlyReport;
        if (!state.eosMonthlySnapshot && report.snapshot?.id && report.snapshot.id !== 'default') {
            try { state.eosMonthlySnapshot = (await getFullSnapshot(report.snapshot.id))?.snapshot || null; }
            catch (error) { AppDialog.alert(`读取工程源数据失败：${error.message}`, { title: '读取工程源数据失败', tone: 'error' }); return; }
        }
        const month = report.month || '当月';
        const project = buildProjectObject();
        const jsonStr = JSON.stringify(project, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const pad = (n, len = 2) => String(n).padStart(len, '0');
        const now = new Date();
        const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        link.download = isGenericMonthly() ? `${monthlyFilename()}_编辑工程_${month}_${dateStr}.json` : `EOS月报编辑工程_${month}_${dateStr}.eos.json`;
        link.href = url;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        setCopyStatus(`已导出「${month}」月报工程文件（含完整离线数据与定制编辑）`);
    }

    async function applyProjectData(project, sourceTitle = '工程快照') {
        if (!project || typeof project !== 'object') {
            throw new Error('工程或快照内容为空或格式无效。');
        }
        if (project.fileType === 'topic-monthly-project') {
            await importGenericProject(project, { name: sourceTitle });
            return;
        }
        if (project.reportData) monthlyEngine.validateProject({ ...project, topicKey: 'eos', month: project.month || project.reportData.month });
        if (isGenericMonthly()) await switchMonthlyTopic('eos', false);
        monthlyLoadVersion++;
        if (project.fileType !== 'topic-eos-monthly-project' && !project.copyPreferences && !project.reportData) {
            throw new Error('文件类型不匹配，请选择有效的 EOS 月报工程文件 (*.eos.json 或 *.json)。');
        }

        const month = project.month || project.reportData?.month;
        if (!month) {
            throw new Error('工程文件中缺少有效的报告月份信息。');
        }

        // 1. Restore customer mapping config if provided
        if (project.customerMappingConfig && typeof project.customerMappingConfig === 'object') {
            saveMappingConfig(project.customerMappingConfig);
        }

        // 2. Restore copyPreferences into localStorage for the project month & fixed
        if (project.copyPreferences && typeof project.copyPreferences === 'object') {
            const savePrefsForScope = (scope, prefs) => {
                if (!prefs || typeof prefs !== 'object') return;
                let tenant = 'default';
                try { tenant = localStorage.getItem('tools_tenant_id') || tenant; } catch (_) {}
                const key = `topic-eos:monthly-copy:v1:${tenant}:${scope.startsWith('fixed') ? scope : `month:${scope}:${month}`}`;
                try { localStorage.setItem(key, JSON.stringify(prefs)); } catch (_) {}
            };

            savePrefsForScope('monthly', project.copyPreferences.monthly);
            savePrefsForScope('monthly-en', project.copyPreferences.monthlyEn || project.copyPreferences['monthly-en']);
            savePrefsForScope('fixed', project.copyPreferences.fixed);
            savePrefsForScope('fixed-en', project.copyPreferences.fixedEn || project.copyPreferences['fixed-en']);
        }

        // 2.1 Restore syncedCnPreferences into localStorage
        if (project.syncedCnPreferences && typeof project.syncedCnPreferences === 'object') {
            const saveSyncedForScope = (scope, prefs) => {
                if (!prefs || typeof prefs !== 'object') return;
                let tenant = 'default';
                try { tenant = localStorage.getItem('tools_tenant_id') || tenant; } catch (_) {}
                const key = `topic-eos:synced-cn:v1:${tenant}:${scope.startsWith('fixed') ? scope : `month:${scope}:${month}`}`;
                try { localStorage.setItem(key, JSON.stringify(prefs)); } catch (_) {}
            };

            saveSyncedForScope('monthly', project.syncedCnPreferences.monthly);
            saveSyncedForScope('fixed', project.syncedCnPreferences.fixed);
        }

        // 3. Restore source time hidden setting
        if (typeof project.sourceTimeHidden === 'boolean') {
            try {
                localStorage.setItem(SOURCE_TIME_HIDDEN_KEY, project.sourceTimeHidden ? '1' : '0');
            } catch (_) {}
            updateSourceTimeVisibility(project.sourceTimeHidden);
        }

        // 4. Use project.reportData as the active report
        const report = project.reportData || createDefaultReport();
        report.month = month;
        state.eosMonthlyReport = report;
        restorePreTranslate(project);
        state.eosMonthlySnapshot = project.snapshot || report.snapshot || null;
        state.isImportedProject = true;
        state.importedProjectMeta = {
            filename: sourceTitle,
            exportedAt: project.exportedAt,
            month: month
        };

        // Ensure month dropdown has this month selected
        let monthFound = false;
        Array.from(elements.eosMonthlyMonth.options).forEach(opt => {
            if (opt.value === month) {
                opt.selected = true;
                monthFound = true;
            }
        });
        if (!monthFound) {
            const opt = document.createElement('option');
            opt.value = month;
            opt.textContent = `${month} (${sourceTitle})`;
            opt.selected = true;
            elements.eosMonthlyMonth.appendChild(opt);
        }

        setMonthlyEnabled(true);
        elements.eosReportEndmark.textContent = `-- 埃及代表处EOS退网收编简报（${report.month}） --`;
        if (elements.eosReportEndmarkEn) {
            elements.eosReportEndmarkEn.textContent = `-- Egypt Rep Office EOS Retirement & Incorporation Monthly Report (${report.month}) --`;
        }

        const exportTimeStr = project.exportedAt ? formatTime(project.exportedAt) : '近期';
        elements.eosMonthlySource.innerHTML = `<span class="topic-imported-badge">📦 来自${escapeHtml(sourceTitle)}</span> 数据月份 ${report.month} · 数据源：已载入工程《${escapeHtml(sourceTitle)}》（导出于 ${exportTimeStr}） · 包含完整离线数据与定制编辑`;

        for (const scope of ['fixed', 'fixed-en']) {
            const preferences = readCopyPreferences(scope);
            document.querySelectorAll(`[data-eos-copy-scope="${scope}"]`).forEach(block => {
                const key = block.dataset.eosCopyKey;
                const saved = preferences[key];
                const original = state.fixedCopyDefaults.get(`${scope}-${key}`) || state.copyDefaults.get(`${scope}-${key}`);
                if (typeof saved === 'string' || typeof original === 'string') block.innerHTML = sanitizeCopyHtml(typeof saved === 'string' ? saved : original);
            });
        }
        renderEosMonthlyReport(report);
        renderEosMonthlyReportEn(report);
        updateFixedTablesCustomerNames();
        updateBilingualSyncStatus();

        hideTextToolbar();
        setCopyStatus(`已成功载入《${sourceTitle}》，数据与中英文编辑已全部恢复！`);
    }

    async function importProjectFile(file) {
        if (!file) return;
        try {
            const text = await file.text();
            let project;
            try {
                project = JSON.parse(text);
            } catch (err) {
                throw new Error('选中的文件不是合法的 JSON 格式。');
            }
            await applyProjectData(project, file.name);
            AppDialog.alert(`【工程文件导入成功】\n\n数据月份：${project.month || project.reportData?.month}\n来源文件：${file.name}\n\n已完整载入离线报表数据、中英文文案与表格修改，您可直接继续编辑、调整格式或导出。`, { title: '工程文件导入成功', tone: 'success' });
        } catch (error) {
            console.error('导入工程文件失败:', error);
            AppDialog.alert(`导入工程文件失败：${error.message}`, { title: '导入工程文件失败', tone: 'error' });
        }
    }

    // 保存当前月报快照到服务器 (跨设备管理)
    async function saveMonthlySnapshot() {
        if (!state.eosMonthlyReport) {
            AppDialog.alert('当前没有可保存快照的月报数据。', { title: '提示', tone: 'warning' });
            return;
        }
        const report = state.eosMonthlyReport;
        const month = report.month || '当月';
        const defaultName = `${month} 月报快照 (${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })})`;
        const name = await AppDialog.prompt('请输入快照名称（将同步保存至服务器，支持多设备查阅与比对）：', { title: '保存月报快照', label: '快照名称', defaultValue: defaultName, maxLength: 120, confirmText: '保存' });
        if (name === null) return;

        const project = buildProjectObject();
        const htmlContent = elements.eosReportSheet ? elements.eosReportSheet.innerHTML : '';
        const toolKey = 'topic-analysis';
        const topicKey = state.monthlyTopicKey || 'eos';

        try {
            const snap = await window.ReportSnapshotDiff.Store.saveSnapshot({
                toolKey,
                topicKey,
                month,
                name: name.trim() || defaultName,
                summary: {
                    month,
                    topicKey,
                    savedAt: new Date().toISOString(),
                    title: isGenericMonthly() ? monthlyDefinition().title : 'EOS 产品与版本收编'
                },
                payload: {
                    projectData: project,
                    htmlContent
                }
            });
            setCopyStatus(`已成功保存月报快照「${snap.name}」至服务器！`);
            AppDialog.alert(`【快照保存成功】\n\n快照名称：${snap.name}\n数据月份：${month}\n\n已成功持久化至服务器数据库，支持多设备同步。您可随时在「月报快照库」中读取或进行分屏比对。`, { title: '快照保存成功', tone: 'success' });
        } catch (err) {
            console.error('保存月报快照失败:', err);
            AppDialog.alert(`保存快照失败：${err.message}`, { title: '保存快照失败', tone: 'error' });
        }
    }

    // 打开月报快照库
    function manageMonthlySnapshots() {
        const toolKey = 'topic-analysis';
        const topicKey = state.monthlyTopicKey || 'eos';
        window.ReportSnapshotDiff.openSnapshotManager({
            toolKey,
            topicKey,
            onSaveNewSnapshot: saveMonthlySnapshot,
            onCompareSnapshot: (snapId) => openMonthlyDiff(snapId),
            onRestoreSnapshot: async (snap) => {
                if (snap?.payload?.projectData) {
                    await applyProjectData(snap.payload.projectData, `快照《${snap.name}》`);
                } else if (snap?.payload) {
                    await applyProjectData(snap.payload, `快照《${snap.name}》`);
                }
            }
        });
    }

    // 打开月报智能分屏比对
    async function openMonthlyDiff(baselineSnapshotId = null) {
        if (!state.eosMonthlyReport) {
            AppDialog.alert('当前没有可比对的月报数据。', { title: '提示', tone: 'warning' });
            return;
        }
        const toolKey = 'topic-analysis';
        const topicKey = state.monthlyTopicKey || 'eos';
        const htmlContent = elements.eosReportSheet ? elements.eosReportSheet.innerHTML : '';
        const project = buildProjectObject();

        await window.ReportSnapshotDiff.Viewer.openDiffModal({
            toolKey,
            topicKey,
            baselineSnapshotId,
            currentHtml: htmlContent,
            currentProject: project,
            onApplyToWorkspace: ({ rightSheet }) => {
                if (!rightSheet || !elements.eosReportSheet) return;
                // 将比对窗口中的编辑写回 elements.eosReportSheet
                const editedBlocks = rightSheet.querySelectorAll('[data-eos-copy-key]');
                editedBlocks.forEach(editedEl => {
                    const key = editedEl.dataset.eosCopyKey;
                    const scope = editedEl.dataset.eosCopyScope || 'monthly';
                    const targetEl = elements.eosReportSheet.querySelector(`[data-eos-copy-key="${key}"][data-eos-copy-scope="${scope}"]`);
                    if (targetEl) {
                        targetEl.innerHTML = sanitizeCopyHtml(editedEl.innerHTML);
                        saveCopy(targetEl);
                    }
                });
                updateBilingualSyncStatus();
                setCopyStatus('已将分屏比对修改成功应用至当前工作区！');
            }
        });
    }

    function restorePreTranslate(project) {
        for (const [field, scope] of [['monthlyEn', 'monthly-en'], ['fixedEn', 'fixed-en']]) {
            try {
                const value = project.preTranslatePreferences?.[field] || {};
                localStorage.setItem(preTranslateStorageKey(scope), JSON.stringify(value));
            } catch (_) {}
        }
    }

    async function importGenericProject(project, file) {
        const key = monthlyEngine.validateProject(project);
        if (key !== state.monthlyTopicKey) await switchMonthlyTopic(key, false);
        monthlyLoadVersion++;
        state.eosMonthlyReport = project.reportData;
        state.eosMonthlySnapshot = project.snapshot || null;
        state.isImportedProject = true;
        state.importedProjectMeta = { filename: file.name, exportedAt: project.exportedAt, month: project.month };
        for (const defaultKey of state.copyDefaults.keys()) if (defaultKey.startsWith('monthly-')) state.copyDefaults.delete(defaultKey);
        for (const [field, scope] of [['monthly', 'monthly'], ['monthlyEn', 'monthly-en']]) {
            const value = project.copyPreferences?.[field] || project.copyPreferences?.[scope] || {};
            localStorage.setItem(copyStorageKey(scope), JSON.stringify(value));
        }
        localStorage.setItem(syncedCnStorageKey('monthly'), JSON.stringify(project.syncedCnPreferences?.monthly || {}));
        restorePreTranslate(project);
        updateSourceTimeVisibility(Boolean(project.sourceTimeHidden));
        try { localStorage.setItem(SOURCE_TIME_HIDDEN_KEY, project.sourceTimeHidden ? '1' : '0'); } catch (_) {}
        elements.eosMonthlyMonth.innerHTML = `<option value="${escapeHtml(project.month)}">${escapeHtml(project.month)} (工程文件)</option>`;
        elements.eosMonthlySource.innerHTML = `<span class="topic-imported-badge">📦 来自导入工程文件</span> 数据月份 ${escapeHtml(project.month)} · ${escapeHtml(file.name)}`;
        setMonthlyEnabled(true);
        renderEosMonthlyReport(project.reportData); renderEosMonthlyReportEn(project.reportData);
        setCopyStatus(`已恢复「${monthlyDefinition().title}」工程及中英文编辑`);
    }

    function createDefaultReport() {
        return {
            month: '2026-03',
            snapshot: { id: 'default', name: '官方基线基准数据', capturedAt: '2026-03-31T10:00:00.000Z', importedAt: '2026-03-31T10:00:00.000Z' },
            product: {
                total: { quantity: 476, incorporated: 238, currentRate: 50.42, pending: 238, annualPlan: 70, noPlan: 168, plannedRate: 64.7 },
                accounts: [
                    {
                        customer: 'e&', quantity: 246, incorporated: 66, currentRate: 26.8, pending: 174, annualPlan: 62, noPlan: 112, plannedRate: 52.0,
                        topNoPlanItems: [
                            { label: 'OptiX OSN 9500', noPlan: 110 },
                            { label: 'OptiX OSN 3500', noPlan: 2 }
                        ],
                        topPlanItems: [{ label: 'OptiX OSN 9500', annualPlan: 62 }]
                    },
                    {
                        customer: 'Vodafone', quantity: 140, incorporated: 82, currentRate: 58.6, pending: 58, annualPlan: 8, noPlan: 50, plannedRate: 64.3,
                        topNoPlanItems: [
                            { label: 'OptiX OSN 3500', noPlan: 50 }
                        ],
                        topPlanItems: [{ label: 'OptiX OSN 3500', annualPlan: 8 }]
                    },
                    {
                        customer: 'WE', quantity: 18, incorporated: 12, currentRate: 66.7, pending: 6, annualPlan: 0, noPlan: 6, plannedRate: 66.7,
                        topNoPlanItems: [
                            { label: 'OptiX OSN 3500', noPlan: 6 }
                        ],
                        topPlanItems: []
                    },
                    {
                        customer: 'Orange', quantity: 72, incorporated: 78, currentRate: 100.0, pending: 0, annualPlan: 0, noPlan: 0, plannedRate: 100.0,
                        topNoPlanItems: [],
                        topPlanItems: []
                    }
                ],
                priorities: [
                    { customer: 'e&', label: 'OptiX OSN 9500', noPlan: 110 },
                    { customer: 'Vodafone', label: 'OptiX OSN 3500', noPlan: 50 },
                    { customer: 'WE', label: 'OptiX OSN 3500', noPlan: 6 },
                    { customer: 'e&', label: 'OptiX OSN 3500', noPlan: 2 }
                ]
            },
            version: {
                total: { quantity: 616, incorporated: 57, currentRate: 9.25, pending: 572, annualPlan: 304, noPlan: 268, plannedRate: 58.7 },
                accounts: [
                    {
                        customer: 'TE', quantity: 190, incorporated: 0, currentRate: 0.0, pending: 190, annualPlan: 169, noPlan: 21, plannedRate: 88.9,
                        topPlanItems: [{ label: 'OptiX OSN 1500', annualPlan: 169 }],
                        topNoPlanItems: [{ label: '待明确版本', noPlan: 21 }]
                    },
                    {
                        customer: 'e&', quantity: 151, incorporated: 20, currentRate: 13.2, pending: 131, annualPlan: 102, noPlan: 29, plannedRate: 80.8,
                        topPlanItems: [{ label: 'OptiX OSN 9500', annualPlan: 102 }],
                        topNoPlanItems: [
                            { label: 'OptiX OSN 9500', noPlan: 20 },
                            { label: 'OptiX OSN 3500', noPlan: 9 }
                        ]
                    },
                    {
                        customer: 'Vodafone', quantity: 93, incorporated: 17, currentRate: 18.3, pending: 76, annualPlan: 21, noPlan: 55, plannedRate: 40.9,
                        topPlanItems: [{ label: 'OptiX OSN 3500', annualPlan: 21 }],
                        topNoPlanItems: [{ label: 'OptiX OSN 3500', noPlan: 55 }]
                    },
                    {
                        customer: 'Orange', quantity: 33, incorporated: 20, currentRate: 60.6, pending: 13, annualPlan: 13, noPlan: 0, plannedRate: 100.0,
                        topPlanItems: [{ label: 'OptiX OSN 3500', annualPlan: 13 }],
                        topNoPlanItems: []
                    }
                ],
                priorities: [
                    { customer: 'Vodafone', label: 'OptiX OSN 3500', noPlan: 55 },
                    { customer: 'e&', label: 'OptiX OSN 9500', noPlan: 20 },
                    { customer: 'TE', label: '待明确版本', noPlan: 21 },
                    { customer: 'e&', label: 'OptiX OSN 3500', noPlan: 9 }
                ]
            }
        };
    }

    function renderEosMonthlyReport(report) {
        if (isGenericMonthly()) { renderGenericMonthly(report, 'zh'); return; }
        elements.eosMonthlyReport.innerHTML = `
            <h3 class="topic-report-title">埃及代表处EOS退网收编简报（${escapeHtml(report.month)}）</h3>
            <div class="topic-report-objective">
                <p><strong>2026年EOS管理总体目标：</strong></p>
                <p>1、风险管理（CS）： 全量EOS产品&amp;版本风险闭环率 -- 100%</p>
                <p>2、退网收编（MSSD）：①重急EOS产品退网率达成目标 -- 底线30%、目标40%、挑战50%；②重急EOS版本收编率 -- 底线70%、目标80%、挑战90%</p>
            </div>
            <div class="topic-report-section-bar">进展概述</div>
            ${buildOverviewCopyHtml(report)}
            <div class="topic-report-section-bar">进展详情</div>
            ${renderMonthlySection(report.product, '产品')}
            ${renderMonthlySection(report.version, '版本')}
        `;
        activateCopy(elements.eosMonthlyReport, MONTHLY_COPY_SELECTOR, 'monthly');
        activateTableCells(elements.eosMonthlyReport.querySelector('#eosMonthlyTable_prod'), 'prod', 'monthly');
        activateTableCells(elements.eosMonthlyReport.querySelector('#eosMonthlyTable_ver'), 'ver', 'monthly');
        updateBilingualSyncStatus();
    }

    function renderEosMonthlyReportEn(report) {
        if (isGenericMonthly()) { renderGenericMonthly(report, 'en'); return; }
        if (!elements.eosMonthlyReportEn) return;
        elements.eosMonthlyReportEn.innerHTML = `
            <h3 class="topic-report-title">Egypt Rep Office EOS Retirement &amp; Incorporation Monthly Report (${escapeHtml(report.month)})</h3>
            <div class="topic-report-objective">
                <p><strong>Overall EOS Management Objectives for 2026:</strong></p>
                <p>1. Risk Management (CS): 100% risk closure rate for all EOS products &amp; versions</p>
                <p>2. Retirement &amp; Incorporation (MSSD): (1) Critical &amp; urgent EOS product retirement rate -- Bottom-line 30%, Target 40%, Challenge 50%; (2) Critical &amp; urgent EOS version incorporation rate -- Bottom-line 70%, Target 80%, Challenge 90%</p>
            </div>
            <div class="topic-report-section-bar">Progress Overview</div>
            ${buildOverviewCopyHtmlEn(report)}
            <div class="topic-report-section-bar">Progress Details</div>
            ${renderMonthlySectionEn(report.product, 'Product')}
            ${renderMonthlySectionEn(report.version, 'Version')}
        `;
        activateCopy(elements.eosMonthlyReportEn, MONTHLY_COPY_SELECTOR, 'monthly-en');
        activateTableCells(elements.eosMonthlyReportEn.querySelector('#eosMonthlyTableEn_prod'), 'prod', 'monthly-en');
        activateTableCells(elements.eosMonthlyReportEn.querySelector('#eosMonthlyTableEn_ver'), 'ver', 'monthly-en');
        updateBilingualSyncStatus();
    }

    function updateFixedTablesCustomerNames() {
        if (isGenericMonthly()) return;
        const sheet = elements.eosReportSheet || document.getElementById('eosReportSheet');
        if (!sheet) return;
        sheet.querySelectorAll('th[data-cust]').forEach(th => {
            const rawCust = th.getAttribute('data-cust');
            const key = th.dataset?.eosCopyKey;
            const scope = th.dataset?.eosCopyScope;
            const prefs = scope ? readCopyPreferences(scope) : {};
            if (key && typeof prefs[key] === 'string') {
                return;
            }
            th.textContent = mapCustomerName(rawCust);
        });

        const fixedPrefs = readCopyPreferences('fixed');
        const fixedEnPrefs = readCopyPreferences('fixed-en');

        const custE = escapeHtml(mapCustomerName('e&'));
        const custV = escapeHtml(mapCustomerName('Vodafone'));
        const custT = escapeHtml(mapCustomerName('TE'));
        const custO = escapeHtml(mapCustomerName('Orange'));

        const prodFocusCn = document.querySelector('.topic-fixed-product-focus');
        if (prodFocusCn && !fixedPrefs[prodFocusCn.dataset?.eosCopyKey]) {
            prodFocusCn.innerHTML = `重点关注：982套EOL网元仍在网运行，服务支持受限，故障后风险高，建议系统部加快推动设备替换、退网或申请例外销售，其中：${custE} 522套（MA5600 272套/Metro 1000 134套）、${custV} 419套（ATN910 306套/PTN6900 47套）、${custT} 24套（UAC3000 2套）、${custO} 17套（CE12804S 8套）。`;
        }
        const verFocusCn = document.querySelector('.topic-fixed-version-focus');
        if (verFocusCn && !fixedPrefs[verFocusCn.dataset?.eosCopyKey]) {
            verFocusCn.innerHTML = `重点关注：25,783套网元虽然已完成客户界面风险预警，但仍存在软件缺陷无法及时补丁修复的风险，同时也是软件升级销售机会点，建议系统部持续推动客户进行版本升级。其中${custE} 14,512套（RTN950 4,217套/RTN320 1,948套/BTS3900A 1,031套等）、${custV} 4,989套（RTN380 2,427套/RTN905 1,607套/RTN980 326套)、${custT} 5290套（DBS3900 1,798套/RTN905 1,313套/MA5800 691套等)、${custO} 992套（BTS3900 877套等）`;
        }

        const prodFocusEn = document.querySelector('.topic-fixed-product-focus-en');
        if (prodFocusEn && !fixedEnPrefs[prodFocusEn.dataset?.eosCopyKey]) {
            prodFocusEn.innerHTML = `Key Focus: 982 EOL NEs are still running on the live network with restricted service support and high risk upon failure. System departments are recommended to accelerate equipment replacement, retirement, or exception sales, including: ${custE} 522 sets (MA5600 272 sets / Metro 1000 134 sets), ${custV} 419 sets (ATN910 306 sets / PTN6900 47 sets), ${custT} 24 sets (UAC3000 2 sets), ${custO} 17 sets (CE12804S 8 sets).`;
        }
        const verFocusEn = document.querySelector('.topic-fixed-version-focus-en');
        if (verFocusEn && !fixedEnPrefs[verFocusEn.dataset?.eosCopyKey]) {
            verFocusEn.innerHTML = `Key Focus: Although risk warnings on the customer interface have been completed for 25,783 NEs, software defects that cannot be patched in time still pose risks and represent software upgrade sales opportunities. System departments are advised to continue promoting version upgrades with customers. Including: ${custE} 14,512 sets (RTN950 4,217 sets / RTN320 1,948 sets / BTS3900A 1,031 sets etc.), ${custV} 4,989 sets (RTN380 2,427 sets / RTN905 1,607 sets / RTN980 326 sets), ${custT} 5,290 sets (DBS3900 1,798 sets / RTN905 1,313 sets / MA5800 691 sets etc.), ${custO} 992 sets (BTS3900 877 sets etc.).`;
        }
    }

    function openMappingModal() {
        if (!elements.eosMappingModal) return;
        const config = readMappingConfig();
        if (elements.eosMinThresholdInput) {
            elements.eosMinThresholdInput.value = config.minThreshold;
        }
        if (elements.eosNewMapKey) elements.eosNewMapKey.value = '';
        if (elements.eosNewMapVal) elements.eosNewMapVal.value = '';
        if (elements.eosMappingStatusMsg) elements.eosMappingStatusMsg.textContent = '';
        renderMappingTableRows(config.aliases);
        elements.eosMappingModal.hidden = false;
        elements.eosMinThresholdInput?.focus();
    }

    function closeMappingModal() {
        if (!elements.eosMappingModal) return;
        elements.eosMappingModal.hidden = true;
    }

    function renderMappingTableRows(aliases) {
        if (!elements.eosMappingTableBody) return;
        const entries = Object.entries(aliases || {});
        if (!entries.length) {
            elements.eosMappingTableBody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:#64748b;padding:14px;">暂无映射规则，可在下方输入添加</td></tr>`;
            return;
        }
        elements.eosMappingTableBody.innerHTML = entries.map(([key, val]) => `
            <tr data-map-row>
                <td><input type="text" class="topic-mapping-key-cell" value="${escapeHtml(key)}" placeholder="原始客户名称"></td>
                <td><input type="text" class="topic-mapping-val-cell" value="${escapeHtml(val)}" placeholder="映射显示名称"></td>
                <td style="text-align:center"><button type="button" class="topic-mapping-del-btn" title="删除此规则" aria-label="删除此规则">✕</button></td>
            </tr>
        `).join('');
    }

    function addMappingRuleFromInputs() {
        const key = elements.eosNewMapKey?.value.trim();
        const val = elements.eosNewMapVal?.value.trim();
        if (!key) {
            if (elements.eosMappingStatusMsg) elements.eosMappingStatusMsg.textContent = '请输入原始客户名称';
            elements.eosNewMapKey?.focus();
            return;
        }
        if (!val) {
            if (elements.eosMappingStatusMsg) elements.eosMappingStatusMsg.textContent = '请输入映射显示名称';
            elements.eosNewMapVal?.focus();
            return;
        }
        let updated = false;
        elements.eosMappingTableBody.querySelectorAll('tr[data-map-row]').forEach(tr => {
            const kInput = tr.querySelector('.topic-mapping-key-cell');
            if (kInput && kInput.value.trim() === key) {
                const vInput = tr.querySelector('.topic-mapping-val-cell');
                if (vInput) vInput.value = val;
                updated = true;
            }
        });
        if (updated) {
            if (elements.eosMappingStatusMsg) elements.eosMappingStatusMsg.textContent = `已更新已存在的客户「${key}」映射`;
        } else {
            const tr = document.createElement('tr');
            tr.setAttribute('data-map-row', '');
            tr.innerHTML = `
                <td><input type="text" class="topic-mapping-key-cell" value="${escapeHtml(key)}" placeholder="原始客户名称"></td>
                <td><input type="text" class="topic-mapping-val-cell" value="${escapeHtml(val)}" placeholder="映射显示名称"></td>
                <td style="text-align:center"><button type="button" class="topic-mapping-del-btn" title="删除此规则" aria-label="删除此规则">✕</button></td>
            `;
            elements.eosMappingTableBody.appendChild(tr);
            if (elements.eosMappingStatusMsg) elements.eosMappingStatusMsg.textContent = `已添加映射「${key} ➔ ${val}」`;
        }
        elements.eosNewMapKey.value = '';
        elements.eosNewMapVal.value = '';
        elements.eosNewMapKey.focus();
    }

    async function resetDefaultMappingsInModal() {
        if (!await AppDialog.confirm('确定恢复默认映射配置？（Etisalat Misr ➔ e&，Orange Egypt for Telecommunications ➔ Orange，Vodafone Egypt ➔ Vodafone，Telecom Egypt ➔ TE，默认阈值 10 套）', { title: '恢复默认映射', confirmText: '恢复默认' })) return;
        if (elements.eosMinThresholdInput) elements.eosMinThresholdInput.value = DEFAULT_MIN_THRESHOLD;
        renderMappingTableRows(DEFAULT_MAPPINGS);
        if (elements.eosMappingStatusMsg) elements.eosMappingStatusMsg.textContent = '已重置为内置默认映射规则与阈值';
    }

    function saveAndApplyMappingConfig() {
        const minThreshold = Math.max(0, parseInt(elements.eosMinThresholdInput?.value, 10) || 0);
        const aliases = {};
        elements.eosMappingTableBody?.querySelectorAll('tr[data-map-row]').forEach(tr => {
            const key = tr.querySelector('.topic-mapping-key-cell')?.value.trim();
            const val = tr.querySelector('.topic-mapping-val-cell')?.value.trim();
            if (key) {
                aliases[key] = val || key;
            }
        });
        const newKey = elements.eosNewMapKey?.value.trim();
        const newVal = elements.eosNewMapVal?.value.trim();
        if (newKey && newVal) {
            aliases[newKey] = newVal;
        }
        saveMappingConfig({ minThreshold, aliases });
        closeMappingModal();
        if (state.eosMonthlyReport) {
            renderEosMonthlyReport(state.eosMonthlyReport);
            renderEosMonthlyReportEn(state.eosMonthlyReport);
            updateFixedTablesCustomerNames();
        }
        setCopyStatus('映射与阈值配置已保存并实时生效');
    }

    async function loadMonthlyReport(month = '') {
        const requestVersion = ++monthlyLoadVersion;
        state.isImportedProject = false;
        state.importedProjectMeta = null;
        elements.eosMonthlyReport.textContent = '正在生成月报…';
        if (elements.eosMonthlyReportEn) elements.eosMonthlyReportEn.textContent = 'Generating English monthly report…';
        state.eosMonthlySnapshot = null;
        // Defaults are tied to the rendered month, while fixed EOS defaults remain intact.
        state.eosMonthlyReport = null;
        for (const key of state.copyDefaults.keys()) if (key.startsWith('monthly-')) state.copyDefaults.delete(key);
        if (isGenericMonthly()) return loadGenericMonthlyReport(month, requestVersion);
        setMonthlyEnabled(false);
        try {
            const result = await API.get(`/api/topic-snapshots/eos-monthly-report${month ? `?month=${encodeURIComponent(month)}` : ''}`);
            if (requestVersion !== monthlyLoadVersion) return;
            let report = result.report;
            if (!report) {
                report = createDefaultReport();
                elements.eosMonthlyMonth.innerHTML = `<option value="${report.month}" selected>${report.month}</option>`;
            } else {
                elements.eosMonthlyMonth.innerHTML = (result.months || []).map(value => `<option value="${escapeHtml(value)}"${result.report?.month === value ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('');
            }
            state.eosMonthlyReport = report;
            setMonthlyEnabled(true);
            elements.eosCopyResetMonth.disabled = false;
            if (elements.eosDownloadPng) elements.eosDownloadPng.disabled = false;
            if (elements.eosDownloadPdf) elements.eosDownloadPdf.disabled = false;
            if (elements.eosDownloadHtml) elements.eosDownloadHtml.disabled = false;
            if (elements.eosDownloadExcel) elements.eosDownloadExcel.disabled = false;
            if (elements.eosDownloadMsg) elements.eosDownloadMsg.disabled = false;
            elements.eosReportEndmark.textContent = `-- 埃及代表处EOS退网收编简报（${report.month}） --`;
            if (elements.eosReportEndmarkEn) {
                elements.eosReportEndmarkEn.textContent = `-- Egypt Rep Office EOS Retirement & Incorporation Monthly Report (${report.month}) --`;
            }
            elements.eosMonthlySource.textContent = `数据月份 ${report.month} · 数据时间 ${formatTime(report.snapshot.capturedAt)} · 导入时间 ${formatTime(report.snapshot.importedAt)}${report.snapshot.name ? ` · ${report.snapshot.name}` : ''}`;
            renderEosMonthlyReport(report);
            renderEosMonthlyReportEn(report);
            updateFixedTablesCustomerNames();
            updateBilingualSyncStatus();
        } catch (error) {
            if (requestVersion !== monthlyLoadVersion) return;
            const report = createDefaultReport();
            state.eosMonthlyReport = report;
            setMonthlyEnabled(true);
            elements.eosCopyResetMonth.disabled = false;
            if (elements.eosDownloadPng) elements.eosDownloadPng.disabled = false;
            if (elements.eosDownloadPdf) elements.eosDownloadPdf.disabled = false;
            if (elements.eosDownloadHtml) elements.eosDownloadHtml.disabled = false;
            if (elements.eosDownloadExcel) elements.eosDownloadExcel.disabled = false;
            if (elements.eosDownloadMsg) elements.eosDownloadMsg.disabled = false;
            elements.eosReportEndmark.textContent = `-- 埃及代表处EOS退网收编简报（${report.month}） --`;
            if (elements.eosReportEndmarkEn) {
                elements.eosReportEndmarkEn.textContent = `-- Egypt Rep Office EOS Retirement & Incorporation Monthly Report (${report.month}) --`;
            }
            elements.eosMonthlySource.textContent = `数据月份 ${report.month} · 演示基准数据`;
            renderEosMonthlyReport(report);
            renderEosMonthlyReportEn(report);
            updateFixedTablesCustomerNames();
            updateBilingualSyncStatus();
        }
    }

    async function loadData() {
        const requestVersion = monthlyLoadVersion;
        elements.loadStatus.textContent = '正在读取…';
        try {
            const result = await API.get('/api/topic-snapshots?limit=200');
            state.items = Array.isArray(result.items) ? result.items : []; state.total = Number(result.total) || state.items.length;
            updateStats(); renderAnalysis(); elements.loadStatus.textContent = `已读取 ${state.items.length} 份快照`;
        } catch (error) { elements.loadStatus.textContent = `读取失败：${error.message}`; elements.trendChart.innerHTML = '<div class="topic-chart-empty">暂时无法读取趋势数据</div>'; }
        if (requestVersion === monthlyLoadVersion) await loadMonthlyReport(elements.eosMonthlyMonth.value);
    }

    async function getFullSnapshot(id) { return (await API.get(`/api/topic-snapshots/${encodeURIComponent(id)}`)).item; }
    async function handleTableAction(event) {
        const button = event.target.closest('button[data-action]'); if (!button) return; const { action, id } = button.dataset; button.disabled = true;
        try {
            if (action === 'delete') { if (!await AppDialog.confirm('确定删除这份历史快照？删除后无法在分析页回顾。', { title: '删除历史快照', tone: 'danger', confirmText: '删除' })) return; await API.delete(`/api/topic-snapshots/${encodeURIComponent(id)}`); await loadData(); return; }
            const item = await getFullSnapshot(id);
            if (action === 'view') { state.detailSnapshot = item; elements.detailTitle.textContent = `${item.platform === 'datafab' ? 'DataFab' : 'NetCare'} · ${formatTime(item.capturedAt)}`; renderDetail(item.snapshot); }
            else { const blob = new Blob([JSON.stringify(item.snapshot, null, 2)], { type: 'application/json;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${item.platform}_topic_${String(item.capturedAt).replace(/[-:T.Z]/g, '').slice(0, 14)}.json`; link.click(); URL.revokeObjectURL(link.href); }
        } catch (error) { AppDialog.alert(`操作失败：${error.message}`, { title: '操作失败', tone: 'error' }); } finally { button.disabled = false; }
    }

    document.addEventListener('DOMContentLoaded', () => {
        [
            'totalCount', 'netcareCount', 'datafabCount', 'latestTime', 'themeToggleButton', 'themeToggleIcon', 'themeToggleText', 'refreshButton',
            'topicFilter', 'metricFilter', 'analysisTitle', 'metricDefinition', 'topicKpis', 'trendChart', 'metricColumnTitle', 'loadStatus',
            'historyBody', 'emptyState', 'eosMonthlyMonth', 'eosMonthlySource', 'eosMonthlyReport', 'eosCopyResetMonth', 'eosCopyResetFixed',
            'eosConfigBtn', 'eosPngDropdown', 'eosDownloadPng', 'eosPngMenu', 'eosDownloadPdf', 'eosDownloadHtml', 'eosDownloadExcel', 'eosDownloadMsg', 'eosReportEndmark', 'eosReportSheet', 'eosCopyStatus', 'eosTextToolbar',
            'eosMonthlyReportEn', 'eosReportEndmarkEn',
            'eosToggleSourceTimeBtn', 'eosToggleSourceTimeIcon', 'eosToggleSourceTimeText', 'eosSyncCapsule', 'eosReportGutter',
            'eosExportProjectBtn', 'eosImportProjectBtn', 'eosProjectFileInput',
            'eosSaveSnapshotBtn', 'eosManageSnapshotsBtn', 'eosDiffBtn',
            'eosMappingModal', 'closeEosMappingModal', 'eosCancelMappingConfigBtn', 'eosSaveMappingConfigBtn', 'eosResetDefaultMappingsBtn', 'eosAddMappingBtn',
            'eosMinThresholdInput', 'eosMappingTableBody', 'eosNewMapKey', 'eosNewMapVal', 'eosMappingStatusMsg',
            'detailModal', 'detailTitle', 'detailSummary', 'detailTable', 'detailJson', 'downloadDetail', 'viewRaw', 'toggleDetailFullscreen',
            'detailTools', 'detailSearch', 'detailPageSize', 'detailSortColumn', 'detailSortDirection', 'closeDetail'
        ].forEach(id => { elements[id] = document.getElementById(id); });
        initTheme();
        if (elements.themeToggleButton) elements.themeToggleButton.addEventListener('click', toggleTheme);
        if (elements.eosConfigBtn) elements.eosConfigBtn.addEventListener('click', openMappingModal);
        if (elements.closeEosMappingModal) elements.closeEosMappingModal.addEventListener('click', closeMappingModal);
        if (elements.eosCancelMappingConfigBtn) elements.eosCancelMappingConfigBtn.addEventListener('click', closeMappingModal);
        if (elements.eosSaveMappingConfigBtn) elements.eosSaveMappingConfigBtn.addEventListener('click', saveAndApplyMappingConfig);
        if (elements.eosResetDefaultMappingsBtn) elements.eosResetDefaultMappingsBtn.addEventListener('click', resetDefaultMappingsInModal);
        if (elements.eosAddMappingBtn) elements.eosAddMappingBtn.addEventListener('click', addMappingRuleFromInputs);
        if (elements.eosMappingModal) {
            elements.eosMappingModal.addEventListener('click', event => { if (event.target === elements.eosMappingModal) closeMappingModal(); });
        }
        if (elements.eosMappingTableBody) {
            elements.eosMappingTableBody.addEventListener('click', event => {
                const btn = event.target.closest('.topic-mapping-del-btn');
                if (!btn) return;
                const tr = btn.closest('tr');
                if (tr) {
                    const keyInput = tr.querySelector('.topic-mapping-key-cell');
                    const keyName = keyInput ? keyInput.value.trim() : '';
                    tr.remove();
                    if (elements.eosMappingStatusMsg) {
                        elements.eosMappingStatusMsg.textContent = keyName
                            ? `已删除「${keyName}」映射（点击下方“保存并应用”即可持久生效）`
                            : '已删除一条映射规则（点击下方“保存并应用”生效）';
                    }
                }
            });
        }
        [elements.eosNewMapKey, elements.eosNewMapVal].forEach(input => {
            if (input) {
                input.addEventListener('keydown', event => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        addMappingRuleFromInputs();
                    }
                });
            }
        });
        if (elements.eosDownloadPng) {
            elements.eosDownloadPng.addEventListener('click', event => {
                event.stopPropagation();
                togglePngDropdown();
            });
        }
        if (elements.eosPngMenu) {
            elements.eosPngMenu.addEventListener('click', event => {
                const item = event.target.closest('[data-png-scope]');
                if (!item) return;
                event.stopPropagation();
                const scope = item.getAttribute('data-png-scope') || 'both';
                closePngDropdown();
                if (!monthlyBusy) monthlyTask(() => exportMonthlyPng(scope));
            });
        }
        if (elements.eosPngDropdown) {
            let timer = null;
            elements.eosPngDropdown.addEventListener('mouseenter', () => {
                if (timer) clearTimeout(timer);
                togglePngDropdown(true);
            });
            elements.eosPngDropdown.addEventListener('mouseleave', () => {
                timer = setTimeout(() => closePngDropdown(), 250);
            });
        }
        for (const [key, action] of [['eosDownloadPdf', exportMonthlyPdf], ['eosDownloadHtml', exportMonthlyHtml], ['eosDownloadExcel', exportMonthlyExcel], ['eosDownloadMsg', exportMonthlyMsg], ['eosExportProjectBtn', exportProjectFile]]) {
            if (elements[key]) elements[key].addEventListener('click', () => { if (!monthlyBusy) monthlyTask(action); });
        }
        if (elements.eosSaveSnapshotBtn) elements.eosSaveSnapshotBtn.addEventListener('click', () => { if (!monthlyBusy) monthlyTask(saveMonthlySnapshot); });
        if (elements.eosManageSnapshotsBtn) elements.eosManageSnapshotsBtn.addEventListener('click', () => { if (!monthlyBusy) manageMonthlySnapshots(); });
        if (elements.eosDiffBtn) elements.eosDiffBtn.addEventListener('click', () => { if (!monthlyBusy) openMonthlyDiff(); });
        if (elements.eosImportProjectBtn && elements.eosProjectFileInput) {
            elements.eosImportProjectBtn.addEventListener('click', () => {
                elements.eosProjectFileInput.value = '';
                elements.eosProjectFileInput.click();
            });
            elements.eosProjectFileInput.addEventListener('change', event => {
                const file = event.target.files && event.target.files[0];
                if (file && !monthlyBusy) {
                    importProjectFile(file);
                }
            });
        }
        document.addEventListener('click', event => {
            if (!event.target.closest('#eosPngDropdown')) {
                closePngDropdown();
            }
            const navLink = event.target.closest('.topic-report-nav-link');
            if (navLink) {
                const href = navLink.getAttribute('href');
                if (href && href.startsWith('#')) {
                    const targetId = href.slice(1);
                    const targetEl = document.getElementById(targetId) || document.querySelector(`a[name="${targetId}"]`);
                    if (targetEl) {
                        event.preventDefault();
                        targetEl.scrollIntoView({ behavior: 'smooth' });
                    }
                }
            }
        });
        let hideSourceTime = false;
        try {
            hideSourceTime = localStorage.getItem(SOURCE_TIME_HIDDEN_KEY) === '1';
        } catch (_) {}
        updateSourceTimeVisibility(hideSourceTime);
        if (elements.eosToggleSourceTimeBtn) {
            elements.eosToggleSourceTimeBtn.addEventListener('click', () => {
                const sourceEl = elements.eosMonthlySource || document.getElementById('eosMonthlySource');
                const isHiddenNow = sourceEl ? sourceEl.classList.contains('is-hidden') : false;
                const nextHidden = !isHiddenNow;
                updateSourceTimeVisibility(nextHidden);
                try {
                    localStorage.setItem(SOURCE_TIME_HIDDEN_KEY, nextHidden ? '1' : '0');
                } catch (_) {}
            });
        }

        activateCopy(document.querySelector('.topic-fixed-progress:not(.topic-fixed-progress-en)'), FIXED_COPY_SELECTOR, 'fixed');
        const fixedEnProgress = document.querySelector('.topic-fixed-progress-en');
        if (fixedEnProgress) activateCopy(fixedEnProgress, FIXED_COPY_SELECTOR, 'fixed-en');

        activateTableCells(document.getElementById('fixedProductTable'), 'fixed-prod', 'fixed');
        activateTableCells(document.getElementById('fixedVersionTable'), 'fixed-ver', 'fixed');
        activateTableCells(document.getElementById('fixedProductTableEn'), 'fixed-prod', 'fixed-en');
        activateTableCells(document.getElementById('fixedVersionTableEn'), 'fixed-ver', 'fixed-en');
        updateFixedTablesCustomerNames();
        updateBilingualSyncStatus();

        window.addEventListener('resize', () => {
            updateBilingualSyncStatus();
        });

        document.addEventListener('selectionchange', rememberTextSelection);
        document.addEventListener('mousedown', event => { if (!event.target.closest('.topic-report-sheet .topic-editable, #eosTextToolbar')) hideTextToolbar(); });
        elements.eosTextToolbar.addEventListener('mousedown', event => event.preventDefault());
        elements.eosTextToolbar.addEventListener('click', event => {
            const button = event.target.closest('button'); if (!button) return;
            if (button.dataset.eosFormat === 'bold') applyTextFormat('bold');
            else if (button.dataset.eosColor) applyTextFormat('foreColor', button.dataset.eosColor);
        });
        elements.eosCopyResetMonth.addEventListener('click', () => {
            if (!state.eosMonthlyReport) return;
            try {
                localStorage.removeItem(copyStorageKey('monthly'));
                localStorage.removeItem(copyStorageKey('monthly-en'));
                localStorage.removeItem(syncedCnStorageKey('monthly'));
                localStorage.removeItem(preTranslateStorageKey('monthly-en'));
            } catch (_) { setCopyStatus('浏览器未能清除偏好'); return; }
            renderEosMonthlyReport(state.eosMonthlyReport);
            renderEosMonthlyReportEn(state.eosMonthlyReport);
            hideTextToolbar();
            hideDiffPopover(true);
            updateBilingualSyncStatus();
            setCopyStatus('已恢复本月中英文自动文案');
        });
        elements.eosCopyResetFixed.addEventListener('click', () => {
            try {
                localStorage.removeItem(copyStorageKey('fixed'));
                localStorage.removeItem(copyStorageKey('fixed-en'));
                localStorage.removeItem(syncedCnStorageKey('fixed'));
                localStorage.removeItem(preTranslateStorageKey('fixed-en'));
            } catch (_) { setCopyStatus('浏览器未能清除偏好'); return; }
            document.querySelectorAll('.topic-fixed-progress:not(.topic-fixed-progress-en) .topic-editable').forEach(block => {
                const defaultKey = `fixed-${block.dataset.eosCopyKey}`;
                if (state.fixedCopyDefaults.has(defaultKey)) block.innerHTML = state.fixedCopyDefaults.get(defaultKey);
                else if (state.copyDefaults.has(defaultKey)) block.innerHTML = state.copyDefaults.get(defaultKey);
            });
            document.querySelectorAll('.topic-fixed-progress-en .topic-editable').forEach(block => {
                const defaultKey = `fixed-en-${block.dataset.eosCopyKey}`;
                if (state.fixedCopyDefaults.has(defaultKey)) block.innerHTML = state.fixedCopyDefaults.get(defaultKey);
                else if (state.copyDefaults.has(defaultKey)) block.innerHTML = state.copyDefaults.get(defaultKey);
            });
            updateFixedTablesCustomerNames();
            hideTextToolbar();
            hideDiffPopover(true);
            updateBilingualSyncStatus();
            setCopyStatus('已恢复中英文固定文案');
        });
        const monthlyTopicSelect = document.getElementById('monthlyTopic');
        monthlyTopicSelect.innerHTML = monthlyEngine.list.map(item => `<option value="${item.key}">${escapeHtml(item.title)}</option>`).join('');
        monthlyTopicSelect.addEventListener('change', event => switchMonthlyTopic(event.target.value));
        elements.eosMonthlyMonth.addEventListener('change', event => loadMonthlyReport(event.target.value));
        renderTopicControls(); elements.refreshButton.addEventListener('click', loadData);
        elements.topicFilter.addEventListener('change', event => { state.topicKey = event.target.value; state.metricKey = topic().metrics[0].key; renderTopicControls(); renderAnalysis(); });
        elements.metricFilter.addEventListener('change', event => { state.metricKey = event.target.value; renderAnalysis(); });
        elements.historyBody.addEventListener('click', handleTableAction); elements.downloadDetail.addEventListener('click', () => { if (state.detailSnapshot) downloadDetailTable(state.detailSnapshot.snapshot); }); elements.viewRaw.addEventListener('click', () => { if (!state.detailSnapshot) return; const showingRaw = !elements.detailJson.hidden; elements.detailJson.textContent = JSON.stringify(state.detailSnapshot.snapshot, null, 2); elements.detailJson.hidden = showingRaw; elements.detailTable.hidden = !showingRaw; elements.detailTools.hidden = !showingRaw; elements.viewRaw.textContent = showingRaw ? '原始 JSON' : '返回详表'; }); elements.detailSearch.addEventListener('input', event => { state.detailFilter = event.target.value.trim().toLowerCase(); state.detailPage = 1; renderDetailTable(); }); elements.detailPageSize.addEventListener('change', event => { state.detailPageSize = Number(event.target.value) || 50; state.detailPage = 1; renderDetailTable(); }); elements.detailSortColumn.addEventListener('change', event => { state.detailSortColumn = event.target.value; state.detailPage = 1; renderDetailTable(); }); elements.detailSortDirection.addEventListener('click', () => { state.detailSortAscending = !state.detailSortAscending; elements.detailSortDirection.textContent = state.detailSortAscending ? '升序' : '降序'; renderDetailTable(); }); elements.detailTable.addEventListener('click', event => { const button = event.target.closest('[data-detail-page]'); if (!button) return; state.detailPage += button.dataset.detailPage === 'next' ? 1 : -1; renderDetailTable(); }); elements.toggleDetailFullscreen.addEventListener('click', () => { elements.detailModal.classList.toggle('is-fullscreen'); elements.toggleDetailFullscreen.textContent = elements.detailModal.classList.contains('is-fullscreen') ? '退出全屏' : '全屏'; }); elements.closeDetail.addEventListener('click', () => { elements.detailModal.classList.remove('is-fullscreen'); elements.toggleDetailFullscreen.textContent = '全屏'; elements.detailModal.hidden = true; });
        elements.detailModal.addEventListener('click', event => { if (event.target === elements.detailModal) elements.detailModal.hidden = true; }); loadData(); checkAiAssistantStatus(); syncMappingConfigFromServer();
    });
}());
