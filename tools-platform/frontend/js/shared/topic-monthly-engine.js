/* Shared, DOM-free report definitions. Used by the browser and the snapshot API. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TopicMonthlyEngine = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const definitions = {
        eos: { title: 'EOS 产品与版本收编 · 进展月报', en: 'EOS Product & Version Progress', platform: 'netcare', filename: '埃及代表处EOS退网收编简报', legacy: true },
        certificate: { title: '证书风险 · 消减月报', en: 'Certificate Risk Reduction Monthly Report', platform: 'netcare' },
        change: { title: '变更质量 · 运营月报', en: 'Change Quality Monthly Report', platform: 'netcare' },
        interception: { title: '高危拦截 · 防护月报', en: 'High-risk Interception Monthly Report', platform: 'netcare' },
        sr: { title: 'SR 问题单 · 质量月报', en: 'SR Service Quality Monthly Report', platform: 'netcare' },
        return: { title: '日志回传 · 进展月报', en: 'Log Return Monthly Report', platform: 'datafab' },
        filing: { title: '日志备案 · 分析月报', en: 'Log Filing Monthly Report', platform: 'datafab' }
    };
    const list = Object.entries(definitions).map(([key, value]) => Object.freeze({ key, filename: value.title.replace(' · ', ''), ...value }));
    const get = key => list.find(item => item.key === key);
    const number = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
    const n = value => number(value) ?? 0;
    const round2 = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(Number(value).toFixed(2));
    const sum = (rows, key) => rows.length && rows.some(row => number(row[key]) !== null) ? rows.reduce((total, row) => total + n(row[key]), 0) : null;
    const percent = value => number(value) === null ? null : round2(Math.abs(Number(value)) <= 1 ? Number(value) * 100 : Number(value));
    const ratio = (a, b) => number(a) === null || !n(b) ? null : round2(Number(a) / Number(b) * 100);
    const yoy = (a, b) => number(a) === null || !n(b) ? null : round2((Number(a) - Number(b)) / Number(b) * 100);
    const text = (zh, en) => ({ zh, en });
    const column = (key, zh, en, unit = '') => ({ key, ...text(zh, en), unit });
    const section = (id, zh, en, columns, rows) => ({ id, ...text(zh, en), columns, rows });
    const fmt = (value, unit = '') => number(value) === null ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: unit === '%' ? 2 : 0 }) + unit;
    function period(snapshot, key) {
        const data = snapshot?.data || {};
        const settings = snapshot?.settings || {};
        const source = ['change', 'interception', 'sr'].includes(key) ? data[key] : null;
        const year = source?.currentYear || settings.year || data.sr?.currentYear;
        const month = source?.currentMonth || settings.month || data.sr?.currentMonth;
        const value = year && month ? `${year}-${String(month).padStart(2, '0')}` : String(snapshot?.capturedAt || '').slice(0, 7);
        return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : '';
    }
    function available(snapshot, key) {
        const data = snapshot?.data || {};
        if (key === 'certificate') return data.certificate?.length > 0;
        if (key === 'sr') return data.sr?.summary?.length > 0 || data.sr?.monthly?.length > 0;
        if (key === 'change' || key === 'interception') return data[key]?.rows?.length > 0;
        if (key === 'return' || key === 'filing') return data.months?.some(row => n(row.month) === n(snapshot.settings?.month));
        return key === 'eos';
    }
    function weightedRate(rows) {
        const relevant = rows.filter(row => n(row.task_count) > 0);
        if (!relevant.length || relevant.some(row => number(row.operation_success_rate) === null)) return null;
        return round2(relevant.reduce((total, row) => total + n(row.task_count) * percent(row.operation_success_rate), 0) / sum(relevant, 'task_count'));
    }
    function aggregate(rows, key) {
        return key === 'change' ? { count: sum(rows, 'task_count'), rate: weightedRate(rows), rollback: sum(rows, 'rollback_count'), highRisk: sum(rows, 'high_core_total_count') }
            : { count: sum(rows, 'interception_cnt'), command: sum(rows, 'commands_interception_cnt'), graphical: sum(rows, 'graphical_interception_cnt') };
    }
    function build(snapshot, key, month = period(snapshot, key)) {
        const def = get(key);
        if (!def || def.legacy || snapshot?.platform !== def.platform) throw new Error('不支持的月报专题或数据源');
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('月份格式应为 YYYY-MM');
        const data = snapshot.data;
        const year = Number(month.slice(0, 4)); const lastMonth = Number(month.slice(5));
        const report = { topicKey: key, month, sections: [], overview: [], notes: [], detailSheets: [] };
        report.notes.push(text('“—”表示缺少数据或分母为零。文案与表格的手工修改不会重算源数据。', '“—” means unavailable data or a zero denominator. Manual report edits do not recalculate source data.'));
        const add = (...args) => report.sections.push(section(...args));
        const raw = (name, rows) => report.detailSheets.push({ name, rows });
        if (key === 'certificate') {
            const rows = data.certificate || [];
            const bucket = items => { const total = sum(items, 'need_reduce_cnt'); const reduced = sum(items, 'reduced_cnt'); return { total, reduced, pending: total === null || reduced === null ? null : Math.max(0, total - reduced), rate: ratio(reduced, total) }; };
            const total = bucket(rows);
            const cols = [column('label', '范围', 'Scope'), column('total', '需消减', 'Required'), column('reduced', '已消减', 'Reduced'), column('pending', '待消减', 'Pending'), column('rate', '完成率', 'Completion', '%')];
            add('overview', '风险消减概览', 'Risk Reduction Overview', cols, [{ label: text('整体', 'Overall'), ...total }]);
            for (const [id, zh, en, field] of [['customers', '客户风险分布', 'Risk by Customer', 'customer_name'], ['products', '产品线风险分布', 'Risk by Product Line', 'product_line_name']]) {
                const groups = new Map();
                rows.forEach(row => { const label = String(row[field] || (id === 'products' ? row.product_line_map_name : '') || '未分类 / Unclassified'); if (!groups.has(label)) groups.set(label, []); groups.get(label).push(row); });
                add(id, zh, en, cols, [...groups].map(([label, items]) => ({ label, ...bucket(items) })).sort((a, b) => n(b.pending) - n(a.pending)));
            }
            add('priorities', '重点待消减任务（前 10 项）', 'Top 10 Pending Tasks', [column('customer_name', '客户', 'Customer'), column('product_name', '产品', 'Product'), column('task_id', '任务单号', 'Task ID'), column('pending', '待消减', 'Pending')], rows.map(row => ({ ...row, pending: Math.max(0, n(row.need_reduce_cnt) - n(row.reduced_cnt)) })).filter(row => row.pending > 0).sort((a, b) => b.pending - a.pending).slice(0, 10));
            report.overview.push(text(`本期需消减 ${fmt(total.total)} 个，已消减 ${fmt(total.reduced)} 个，待消减 ${fmt(total.pending)} 个，完成率 ${fmt(total.rate, '%')}。`, `Required: ${fmt(total.total)}; reduced: ${fmt(total.reduced)}; pending: ${fmt(total.pending)}; completion: ${fmt(total.rate, '%')}.`));
            report.notes.push(text('证书风险为所选快照时点的库存状态，不代表本月新增或本月消减量。', 'Certificate metrics describe inventory at the snapshot time, not monthly additions or reductions.'));
            raw('证书风险原始明细', rows);
        } else if (key === 'change' || key === 'interception') {
            const source = data[key] || {}; const rows = source.rows || [];
            const priorYear = n(source.previousYear) || year - 1;
            const select = (scope, y, monthly) => rows.filter(row => row.scope === scope && n(row.year) === y && (monthly ? n(row.month) === lastMonth : n(row.month) >= 1 && n(row.month) <= lastMonth));
            const stats = (scope, monthly) => { const current = aggregate(select(scope, year, monthly), key); const previous = aggregate(select(scope, priorYear, monthly), key); return { ...current, previous: previous.count, yoy: yoy(current.count, previous.count) }; };
            const cols = [column('label', '范围', 'Scope'), column('count', key === 'change' ? '变更数' : '拦截数', key === 'change' ? 'Changes' : 'Interceptions'), column('previous', '上年同期', 'Prior-year Period'), column('yoy', '同比', 'YoY', '%'), ...(key === 'change' ? [column('rate', '操作成功率', 'Success Rate', '%'), column('rollback', '回退数', 'Rollbacks'), column('highRisk', '高危核心', 'High-risk Core')] : [column('command', '命令行', 'Command Line'), column('graphical', '图形化', 'Graphical')])];
            const current = stats('TOTAL', true); const cumulative = stats('TOTAL', false);
            add('overview', '当月与年累计', 'Month and Year to Date', cols, [{ label: text('当月', 'Current Month'), ...current }, { label: text('年累计', 'Year to Date'), ...cumulative }]);
            const scopes = [...new Set(rows.map(row => row.scope).filter(scope => scope && scope !== 'TOTAL'))].sort();
            add('scopes', '分业务范围 · 年累计', 'Year to Date by Business Scope', cols, scopes.map(scope => ({ label: scope, ...stats(scope, false) })));
            add('trend', '月度趋势', 'Monthly Trend', [column('label', '月份', 'Month'), ...cols.slice(1).filter(col => !['previous', 'yoy'].includes(col.key))], Array.from({ length: lastMonth }, (_, i) => ({ label: `${year}-${String(i + 1).padStart(2, '0')}`, ...aggregate(rows.filter(row => row.scope === 'TOTAL' && n(row.year) === year && n(row.month) === i + 1), key) })));
            report.overview.push(text(`本月${key === 'change' ? '变更' : '拦截'} ${fmt(current.count)} 次，同比 ${fmt(current.yoy, '%')}；年累计 ${fmt(cumulative.count)} 次，同比 ${fmt(cumulative.yoy, '%')}。`, `Current month: ${fmt(current.count)}, YoY ${fmt(current.yoy, '%')}; year to date: ${fmt(cumulative.count)}, YoY ${fmt(cumulative.yoy, '%')}.`));
            report.notes.push(text('整体只采用 TOTAL 行，分业务范围单列，避免重复累计。缺失月份不按零补齐。', 'Overall totals use TOTAL rows only; business scopes are separate. Missing months are not filled with zero.'));
            if (key === 'change') report.notes.push(text('累计操作成功率按变更任务数加权；重点复盘回退和高危核心操作。', 'Cumulative success rate is weighted by change count. Review rollbacks and high-risk core operations.'));
            else report.notes.push(text('拦截量反映防护触发情况，不能仅凭数量增减判断质量改善或恶化。', 'Interception volume measures protection triggers; changes in volume alone do not establish a quality improvement or deterioration.'));
            raw('专题原始汇总', rows);
        } else if (key === 'sr') {
            const source = data.sr || {}; const summary = source.summary || []; const monthly = source.monthly || [];
            const sr = row => ({ count: number(row?.sr_total), rate: percent(row?.sr_frt), open: number(row?.unclose_sr_cnt), overdue: number(row?.overdue_sr_cnt), major: number(row?.major_sr_cnt), critical: number(row?.critical_sr_cnt) });
            const cols = [column('label', '范围', 'Scope'), column('count', '问题单数', 'SR Count'), column('rate', 'FRT 达成率', 'FRT', '%'), column('open', '未关闭', 'Open'), column('overdue', '逾期', 'Overdue'), column('major', 'Major', 'Major'), column('critical', 'Critical', 'Critical')];
            const currentRows = monthly.filter(row => (!row.scope || row.scope === 'TOTAL') && n(row.year) === year && n(row.month) <= lastMonth);
            const current = sr(currentRows.find(row => n(row.month) === lastMonth));
            const total = sr(summary.find(row => row.scope === 'TOTAL' && row.period === 'currentYtd'));
            const prior = sr(summary.find(row => row.scope === 'TOTAL' && row.period === 'previousYtd'));
            add('overview', '当月与同期概览', 'Current Month and Prior-year Comparison', cols, [{ label: text('当月', 'Current Month'), ...current }, { label: text('年累计', 'Year to Date'), ...total }, { label: text('上年同期', 'Prior-year YTD'), ...prior }]);
            add('scopes', '分业务范围 · 年累计', 'Year to Date by Business Scope', cols, summary.filter(row => row.period === 'currentYtd' && row.scope !== 'TOTAL').map(row => ({ label: row.scope, ...sr(row) })));
            add('trend', '月度趋势', 'Monthly Trend', [column('label', '月份', 'Month'), ...cols.slice(1)], currentRows.slice().sort((a, b) => n(a.month) - n(b.month)).map(row => ({ label: `${year}-${String(row.month).padStart(2, '0')}`, ...sr(row) })));
            report.overview.push(text(`本月 SR ${fmt(current.count)} 单，FRT ${fmt(current.rate, '%')}；年累计 ${fmt(total.count)} 单，同比 ${fmt(yoy(total.count, prior.count), '%')}，累计逾期 ${fmt(total.overdue)} 单。`, `Monthly SRs: ${fmt(current.count)}, FRT ${fmt(current.rate, '%')}; YTD SRs: ${fmt(total.count)}, YoY ${fmt(yoy(total.count, prior.count), '%')}, overdue: ${fmt(total.overdue)}.`));
            report.notes.push(text('累计 FRT 使用快照中的累计达成率，不对各月百分比求平均。重点跟进逾期、未关闭和 Major/Critical 问题单。', 'YTD FRT uses the snapshot’s cumulative rate, not an average of monthly percentages. Follow up overdue, open, Major and Critical SRs.'));
            raw('SR累计汇总', summary); raw('SR月度明细', monthly);
        } else {
            const settings = snapshot.settings || {};
            const months = (data.months || []).filter(row => n(row.month) <= lastMonth && (!row.year || n(row.year) === year)).slice().sort((a, b) => n(a.month) - n(b.month));
            const normalize = row => { const required = number(row.required ?? row.needReturn ?? row.shouldReturn); const returned = number(row.returned ?? row.actualReturn); const recorded = number(row.recorded ?? row.actualRecord); return { label: `${year}-${String(row.month).padStart(2, '0')}`, required, returned, recorded, pending: number(row.pending) ?? (required === null || returned === null ? null : Math.max(0, required - returned)), returnRate: required === 0 ? null : (number(row.returnRate) !== null ? round2(percent(row.returnRate)) : ratio(returned, required)), recordRate: required === 0 ? null : (number(row.recordRate) !== null ? round2(percent(row.recordRate)) : ratio(recorded, required)) }; };
            const currentRaw = months.find(row => n(row.month) === lastMonth);
            const current = currentRaw ? normalize(currentRaw) : {};
            const target = number(settings.targets?.[key === 'return' ? 'returnRate' : 'recordRate']);
            const rate = current[key === 'return' ? 'returnRate' : 'recordRate'];
            const good = number(rate) !== null && target !== null ? (key === 'return' ? rate >= target : rate <= target) : null;
            const cols = [column('label', '月份', 'Month'), column('required', '需回传', 'Required'), column('returned', '已回传', 'Returned'), column('pending', '待回传', 'Pending'), column('returnRate', '回传率', 'Return Rate', '%'), column('recorded', '备案量', 'Filed'), column('recordRate', '备案率', 'Filing Rate', '%')];
            add('overview', '当月概览', 'Current Month', cols, currentRaw ? [current] : []);
            add('trend', '月度趋势', 'Monthly Trend', cols, months.map(normalize));
            if (key === 'return') add('products', '产品线回传表现', 'Return by Product Line', [column('label', '产品线', 'Product Line'), ...cols.slice(1, 5)], (currentRaw?.productLines || []).filter(row => !settings.excludeIct || row.key !== 'ICT').map(row => ({ ...row, label: text(row.labelZh || row.label || row.key, row.labelEn || row.label || row.key), returnRate: n(row.required) ? (number(row.rate) !== null ? round2(percent(row.rate)) : ratio(row.returned, row.required)) : null })).sort((a, b) => n(b.pending) - n(a.pending)));
            const detail = data.detailsByMonth?.[String(lastMonth)] || (n(settings.month) === lastMonth ? data.detail : []) || [];
            report.overview.push(text(`本月${key === 'return' ? '回传率' : '备案率'} ${fmt(rate, '%')}，${key === 'return' ? '目标 ≥' : '上限 ≤'} ${fmt(target, '%')}；${good === null ? '暂无完整数据判断达标情况' : good ? '符合目标要求' : '尚未满足目标要求'}。${key === 'return' ? `待回传 ${fmt(current.pending)} 笔。` : `备案 ${fmt(current.recorded)} 笔。`}`, `${key === 'return' ? 'Return' : 'Filing'} rate: ${fmt(rate, '%')}; ${key === 'return' ? 'target ≥' : 'limit ≤'} ${fmt(target, '%')}. ${good === null ? 'Target assessment unavailable.' : good ? 'Within target.' : 'Outside target.'} ${key === 'return' ? `Pending: ${fmt(current.pending)}.` : `Filed: ${fmt(current.recorded)}.`}`));
            report.notes.push(text(`沿用快照保存的汇总和目标；ICT服务与软件：${settings.excludeIct ? '剔除' : '保留'}；待评分任务：${settings.excludePendingScore ? '剔除' : '保留'}。原始明细保留原口径，可能包含被剔除记录。`, `Uses saved summaries and targets. ICT Services & Software: ${settings.excludeIct ? 'excluded' : 'included'}; pending-rating tasks: ${settings.excludePendingScore ? 'excluded' : 'included'}. Raw detail may include excluded records.`));
            if (key === 'filing') {
                const value = (row, keys) => { for (const field of keys) if (row[field] !== undefined) { const cell = row[field]; return typeof cell === 'object' && cell !== null ? cell.formula ?? cell.summing ?? cell.average ?? '' : cell; } return ''; };
                const groups = new Map();
                detail.forEach(row => {
                    const line = String(value(row, ['产品线', '产品线名称', 'product_line', 'product_line_name'])).toLowerCase().replace(/[\s_\-/&+（）()]/g, '');
                    const status = String(value(row, ['评分任务状态', '回传状态', 'task_status', 'status'])).toLowerCase().replace(/[\s_\-/（）()]/g, '');
                    if (settings.excludeIct && (line === 'ict' || /ict服务与软件|ictservicesandsoftware|ictservicessoftware/.test(line))) return;
                    if (settings.excludePendingScore && /^(待评分|pendingrating|pendingscore|awaitingrating)$/.test(status)) return;
                    const reason = String(value(row, ['备案原因', '备案原因说明', 'filing_reason', 'record_reason', 'recording_reason'])).trim();
                    if (reason) groups.set(reason, (groups.get(reason) || 0) + 1);
                });
                const total = [...groups.values()].reduce((a, b) => a + b, 0);
                add('reasons', '备案原因分布（明细口径）', 'Filing Reasons (Detail Scope)', [column('label', '备案原因', 'Reason'), column('count', '记录数', 'Records'), column('share', '占已填写原因记录', 'Share of Reason Records', '%')], [...groups].map(([label, count]) => ({ label, count, share: ratio(count, total) })).sort((a, b) => b.count - a.count));
                report.notes.push(text('原因分布仅统计所选月份明细中已填写原因且未被剔除的记录，不替代汇总备案量；未填原因不等于应备案未备案。', 'Reason distribution counts eligible detail records with a reason; it does not replace the summary filing total. A blank reason does not imply a missing required filing.'));
            }
            raw('月度汇总原始数据', months); raw('当月原始明细', detail);
        }
        report.sections.push(section('actions', '后续行动', 'Follow-up Actions', [column('action', '行动项', 'Action'), column('owner', '责任人', 'Owner'), column('due', '完成时间', 'Due'), column('status', '进展', 'Status')], [{ action: text('请结合上述重点项补充行动计划', 'Add an action plan based on the findings above'), owner: '', due: '', status: '' }]));
        return report;
    }
    function storageKey(key, kind, tenant, scope, month) {
        const prefix = key === 'eos' ? 'topic-eos' : `topic-monthly:${key}`;
        return `${prefix}:${kind}:v1:${tenant}:${scope.startsWith('fixed') ? scope : `month:${scope}:${month || ''}`}`;
    }
    function validateProject(project) {
        const key = project?.topicKey || (project?.fileType === 'topic-eos-monthly-project' ? 'eos' : '');
        if (!get(key) || !project.reportData || !/^\d{4}-(0[1-9]|1[0-2])$/.test(project.month) || project.reportData.month !== project.month) throw new Error('工程文件的专题、月份或月报数据无效');
        if (key !== 'eos' && (project.fileType !== 'topic-monthly-project' || project.schemaVersion !== 1 || project.reportData.topicKey !== key || !Array.isArray(project.reportData.sections) || !Array.isArray(project.reportData.overview) || !Array.isArray(project.reportData.notes) || !Array.isArray(project.reportData.detailSheets))) throw new Error('不支持的月报工程格式');
        if (key === 'eos' && (!project.reportData.product?.total || !project.reportData.version?.total)) throw new Error('EOS 工程缺少产品或版本数据');
        if (key !== 'eos') for (const item of project.reportData.sections) {
            if (!/^[a-z][a-z0-9-]*$/.test(item.id) || !Array.isArray(item.columns) || !Array.isArray(item.rows) || item.columns.some(col => !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(col.key)) || item.rows.some(row => !row || typeof row !== 'object')) throw new Error('工程文件表格结构无效');
        }
        if (key !== 'eos' && project.reportData.detailSheets.some(sheet => !sheet || typeof sheet.name !== 'string' || !Array.isArray(sheet.rows) || sheet.rows.some(row => !row || typeof row !== 'object' || Array.isArray(row)))) throw new Error('工程文件原始数据表结构无效');
        return key;
    }
    return Object.freeze({ list: Object.freeze(list), get, period, available, build, fmt, round2, storageKey, validateProject });
}));
