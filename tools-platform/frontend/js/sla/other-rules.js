/**
 * sla/other-rules.js - 整改、专项、SR、漏洞规则的配置、持久化与执行引擎
 */
(function () {
    'use strict';

    const DAY_MS = 86400000;
    const HOUR_MS = 3600000;
    const SUPPORTED_MODES = ['rectification', 'special', 'sr', 'vulnerability'];
    const MODE_META = {
        rectification: { name: '整改详单', tone: '#1976d2' },
        special: { name: 'CPT专项风险', tone: '#00796b' },
        sr: { name: 'SR详单', tone: '#d9480f' },
        vulnerability: { name: '漏洞预警详单', tone: '#c2410c' }
    };

    const STANDARD_DEFAULTS = {
        rectification: {
            version: 1,
            statusFields: ['task_status'],
            rules: [
                standardRule('rect-checking', 'Checking', ['Checking'], ['task_create_time'], 'field_plus_days', 30, 'Checking', 29, '#f9a825'),
                standardRule('rect-implementation', 'Rectification Implementation', ['Rectification Implementation'], ['rectify_plan_end_time'], 'date_field', 0, '整改', 81, '#f9a825')
            ]
        },
        special: {
            version: 1,
            statusFields: ['状态-Status', 'task_status_en', 'task_status', 'task_status_cn'],
            rules: [
                standardRule('special-confirm', '待确认', ['待确认', '草稿', 'Draft', 'To Be Confirmed', 'Confirm', 'Confirming'], ['创建日期-Create Date', 'create_time'], 'field_plus_days', 30, '确认', 29, '#00897b'),
                standardRule('special-processing', '处理中', ['处理中', '评审中', 'Processing', 'Reviewing'], ['要求完成日期-Required Completion Date', 'required_completion_time', 'plan_complete_date'], 'date_field', 0, '处理', 29, '#00897b')
            ]
        },
        vulnerability: {
            version: 1,
            statusFields: ['task_status'],
            rules: [
                standardRule('vuln-active', '漏洞处理中', ['Checking', 'Communication Dept', 'Communication Customer'], ['create_time', 'task_create_time'], 'field_plus_days', 30, '漏洞', 29, '#ff9800')
            ]
        }
    };

    const SR_DEFAULT = {
        version: 1,
        fields: {
            status: ['sr_status_name'], severity: ['hw_sev_name', 'urgency'], overdue: ['overdue'],
            openDate: ['open_date'], expectedClose: ['exp_close_date'], suspendedClose: ['sus_exp_close_date', '期望关闭时间-挂起'], actualClose: ['act_close_date']
        },
        values: {
            pending: ['pending', 'suspend', 'suspended', 'hold', '挂起'],
            closed: ['closed', 'resolved', 'canceled', 'cancelled'],
            critical: ['critical', 'schedule action', 'immediate action'],
            overdue: ['y', 'yes', 'true', '1']
        },
        thresholds: {
            criticalDangerConsume: 85, criticalDangerHours: 12,
            criticalWarningConsume: 70, criticalWarningHours: 48,
            normalDangerConsume: 95, normalWarningConsume: 80
        },
        alerts: {
            overdue: alertStyle('SR超期', 'danger', '#d32f2f'),
            criticalDanger: alertStyle('Critical高危', 'danger', '#d32f2f'),
            criticalWarning: alertStyle('Critical预警', 'warning', '#7b1fa2'),
            normalDanger: alertStyle('SR高危', 'danger', '#d32f2f'),
            normalWarning: alertStyle('SR预警', 'warning', '#7b1fa2'),
            pending: alertStyle('挂起忽略', 'none', '#00897b'),
            closed: alertStyle('已关单', 'none', '#00897b'),
            suspendedGood: alertStyle('挂起后未超期', 'none', '#0288d1'),
            suspendedOverdue: alertStyle('挂起后超期', 'danger', '#d32f2f'),
            historicalOverdue: alertStyle('历史超期', 'danger', '#d32f2f')
        }
    };

    const cache = {};
    let editorMode = '';
    let workingConfig = null;

    function standardRule(id, name, values, fields, type, offsetDays, prefix, warningDays, warningColor) {
        return {
            id, enabled: true, name, badgePrefix: prefix,
            match: { operator: 'equals', values, caseSensitive: false },
            deadline: { type, fields, offsetDays },
            alertLevels: [
                { id: `${id}-danger`, enabled: true, name: '紧急', maxDays: 10, severity: 'danger', badgeSuffix: '紧急', color: '#d32f2f' },
                { id: `${id}-warning`, enabled: true, name: '提醒', maxDays: warningDays, severity: 'warning', badgeSuffix: '提醒', color: warningColor }
            ]
        };
    }

    function alertStyle(label, severity, color) { return { enabled: true, label, severity, color }; }
    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function esc(value) { return String(value == null ? '' : value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
    function list(value, fallback) {
        const values = Array.isArray(value) ? value : String(value || '').split(/[\n,，]/);
        const cleaned = values.map(item => String(item || '').trim()).filter(Boolean);
        return cleaned.length ? Array.from(new Set(cleaned)) : clone(fallback || []);
    }
    function num(value, fallback) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
    function severity(value, fallback = 'warning') { return ['danger', 'warning', 'info', 'none'].includes(value) ? value : fallback; }
    function color(value, fallback) { return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback; }
    function prefKey(mode) { return `sla_builtin_rule_${mode}_v1`; }
    function defaultConfig(mode) { return clone(mode === 'sr' ? SR_DEFAULT : STANDARD_DEFAULTS[mode]); }

    function normalizeAlert(raw, fallback, index) {
        return {
            id: String(raw?.id || fallback?.id || `alert-${Date.now()}-${index}`),
            enabled: raw?.enabled !== false,
            name: String(raw?.name || fallback?.name || '告警'),
            maxDays: num(raw?.maxDays, fallback?.maxDays ?? 10),
            severity: severity(raw?.severity, fallback?.severity),
            badgeSuffix: String(raw?.badgeSuffix ?? fallback?.badgeSuffix ?? '提醒'),
            color: color(raw?.color, fallback?.color || '#7b1fa2')
        };
    }
    function normalizeRule(raw, fallback, index) {
        const base = fallback || {};
        const levels = Array.isArray(raw?.alertLevels) && raw.alertLevels.length ? raw.alertLevels : base.alertLevels;
        return {
            id: String(raw?.id || base.id || `rule-${Date.now()}-${index}`), enabled: raw?.enabled !== false,
            name: String(raw?.name || base.name || '新识别规则'), badgePrefix: String(raw?.badgePrefix ?? base.badgePrefix ?? 'SLA'),
            match: {
                operator: ['equals', 'contains', 'regex'].includes(raw?.match?.operator) ? raw.match.operator : (base.match?.operator || 'equals'),
                values: list(raw?.match?.values, base.match?.values || ['新状态']), caseSensitive: raw?.match?.caseSensitive === true
            },
            deadline: {
                type: raw?.deadline?.type === 'field_plus_days' ? 'field_plus_days' : 'date_field',
                fields: list(raw?.deadline?.fields, base.deadline?.fields || ['create_time']),
                offsetDays: num(raw?.deadline?.offsetDays, base.deadline?.offsetDays || 0)
            },
            alertLevels: (levels || []).map((level, i) => normalizeAlert(level, base.alertLevels?.[i], i))
        };
    }
    function normalizeStandard(mode, raw) {
        const base = STANDARD_DEFAULTS[mode];
        const rules = Array.isArray(raw?.rules) && raw.rules.length ? raw.rules : base.rules;
        return { version: 1, statusFields: list(raw?.statusFields, base.statusFields), rules: rules.map((rule, i) => normalizeRule(rule, base.rules[i], i)) };
    }
    function normalizeStyle(raw, fallback) {
        return { enabled: raw?.enabled !== false, label: String(raw?.label ?? fallback.label), severity: severity(raw?.severity, fallback.severity), color: color(raw?.color, fallback.color) };
    }
    function normalizeSR(raw) {
        const base = SR_DEFAULT;
        const result = { version: 1, fields: {}, values: {}, thresholds: {}, alerts: {} };
        Object.keys(base.fields).forEach(key => { result.fields[key] = list(raw?.fields?.[key], base.fields[key]); });
        Object.keys(base.values).forEach(key => { result.values[key] = list(raw?.values?.[key], base.values[key]); });
        Object.keys(base.thresholds).forEach(key => { result.thresholds[key] = num(raw?.thresholds?.[key], base.thresholds[key]); });
        Object.keys(base.alerts).forEach(key => { result.alerts[key] = normalizeStyle(raw?.alerts?.[key], base.alerts[key]); });
        return result;
    }
    function normalizeConfig(mode, raw) { return mode === 'sr' ? normalizeSR(raw) : normalizeStandard(mode, raw); }

    async function loadConfig(mode, force = false) {
        if (!SUPPORTED_MODES.includes(mode)) return null;
        if (!force && cache[mode]) return clone(cache[mode]);
        try {
            const saved = await API.get(`/api/sla/prefs/${encodeURIComponent(prefKey(mode))}`);
            const payload = saved?.prefs || saved;
            cache[mode] = normalizeConfig(mode, payload && Object.keys(payload).length ? payload : defaultConfig(mode));
        } catch (_) { cache[mode] = defaultConfig(mode); }
        return clone(cache[mode]);
    }

    function first(row, fields) {
        for (const field of fields || []) {
            const value = row?.[field];
            if (value !== undefined && value !== null && String(value).trim() !== '') return { field, value: String(value).trim() };
        }
        return { field: '', value: '' };
    }
    function matches(status, match) {
        if (!status) return false;
        const flags = match.caseSensitive ? '' : 'i';
        const actual = match.caseSensitive ? status : status.toLowerCase();
        return match.values.some(raw => {
            const expected = match.caseSensitive ? raw : raw.toLowerCase();
            if (match.operator === 'contains') return actual.includes(expected);
            if (match.operator === 'regex') { try { return new RegExp(raw, flags).test(status); } catch (_) { return false; } }
            return actual === expected;
        });
    }
    function rowClass(type) { return type === 'danger' ? 'danger-row' : (type === 'warning' ? 'warning-row' : (type === 'info' ? 'info-row' : '')); }
    function badge(style) { return `<span class="badge risk-config-badge" style="background:${esc(style.color)} !important;color:#fff !important;">${esc(style.label)}</span>`; }

    function evaluateStandard(mode, row, options = {}) {
        const config = normalizeConfig(mode, options.config || cache[mode] || defaultConfig(mode));
        const status = first(row, config.statusFields).value;
        const rule = config.rules.find(item => item.enabled && matches(status, item.match));
        if (!rule) return null;
        const dateValue = first(row, rule.deadline.fields);
        if (!dateValue.value) return { matched: true, slaDays: 999995, rowClass: '', alertSeverity: '', text: `<span style="color:#ff9800">缺少截止日期</span> ${esc(rule.name)}`, cleanText: `缺少截止日期 (${rule.name})` };
        const parsed = options.parseDate ? options.parseDate(dateValue.value, dateValue.field, rule) : new Date(dateValue.value);
        if (!parsed || isNaN(parsed)) return { matched: true, slaDays: -999999, rowClass: '', alertSeverity: '', text: '<span style="color:red">解析失败</span>', cleanText: '日期解析失败' };
        const deadline = new Date(parsed);
        if (rule.deadline.type === 'field_plus_days') deadline.setDate(deadline.getDate() + rule.deadline.offsetDays);
        const days = Math.ceil((deadline - (options.now || new Date())) / DAY_MS);
        const base = `剩余 ${days} 天`;
        const level = rule.alertLevels.filter(item => item.enabled).sort((a, b) => a.maxDays - b.maxDays).find(item => days <= item.maxDays);
        if (!level) return { matched: true, deadline, slaDays: days, rowClass: '', alertSeverity: '', text: mode === 'vulnerability' ? `${esc(status)} / ${base}` : base, cleanText: mode === 'vulnerability' ? `${status} / ${base}` : base };
        const label = `${rule.badgePrefix}${level.badgeSuffix}`;
        const style = { label, severity: level.severity, color: level.color };
        const suffix = mode === 'vulnerability' ? `${esc(status)} / ${base}` : base;
        return { matched: true, deadline, slaDays: days, rowClass: rowClass(level.severity), alertSeverity: level.severity === 'none' ? '' : level.severity, text: `${badge(style)} ${suffix}`, cleanText: `${label} (${mode === 'vulnerability' ? `${status}, ` : ''}${base})` };
    }

    function containsValue(actual, values) { const text = String(actual || '').toLowerCase(); return values.some(value => text.includes(String(value).toLowerCase())); }
    function formatDuration(hours) {
        const absolute = Math.abs(Math.ceil(hours || 0));
        if (absolute <= 48) return `${absolute} 小时`;
        const days = Math.ceil(absolute / 24);
        if (days < 7) return `${days} 天`;
        if (days < 30) return days % 7 ? `${Math.floor(days / 7)}周${days % 7}天` : `${days / 7}周`;
        return days % 30 ? `${Math.floor(days / 30)}月${days % 30}天` : `${days / 30}月`;
    }
    function result(style, body, clean, days, extra = {}) {
        const enabled = style.enabled !== false;
        return { slaDays: days, rowClass: enabled ? rowClass(style.severity) : '', alertSeverity: enabled && style.severity !== 'none' ? style.severity : '', text: enabled ? `${badge(style)} ${body}` : body, cleanText: enabled ? `${style.label} (${clean})` : clean, ...extra };
    }
    function evaluateSR(row, options = {}) {
        const config = normalizeSR(options.config || cache.sr || SR_DEFAULT);
        const now = options.now || new Date();
        const value = key => first(row, config.fields[key]);
        const parse = (key, usage) => { const item = value(key); return item.value ? (options.parseDate ? options.parseDate(item.value, item.field, { name: usage }) : new Date(item.value)) : null; };
        const status = value('status').value;
        const severityValue = value('severity').value;
        const overdueFlag = value('overdue').value;
        const open = parse('openDate', 'SR 开单时间');
        const expected = parse('expectedClose', 'SR 期望关单时间');
        const suspended = parse('suspendedClose', '挂起后期望关单时间');
        const actual = parse('actualClose', 'SR 实际关单时间');
        const isPending = containsValue(status, config.values.pending);
        const isClosed = containsValue(status, config.values.closed);
        const isCritical = containsValue(severityValue, config.values.critical);
        const upstreamOverdue = config.values.overdue.some(item => String(item).toLowerCase() === String(overdueFlag).toLowerCase());
        if (isPending) return result(config.alerts.pending, esc(status || 'Pending'), status || 'Pending', 999998, { srMeta: { status, severity: isCritical ? 'critical' : 'normal', disposition: 'pending' } });
        if (isClosed) {
            if ((actual && expected && actual > expected) || upstreamOverdue) {
                if (suspended && actual && actual <= suspended) return result(config.alerts.suspendedGood, esc(status || 'Closed'), status || 'Closed', 999997, { srMeta: { status, severity: isCritical ? 'critical' : 'normal', disposition: 'closed' } });
                const reference = suspended || expected;
                const hours = actual && reference ? Math.ceil((actual - reference) / HOUR_MS) : 0;
                const style = suspended ? config.alerts.suspendedOverdue : config.alerts.historicalOverdue;
                const body = hours > 0 ? `已超 ${formatDuration(hours)}` : (suspended ? '已触发挂起超期' : '已触发上游超期标识');
                return result(style, body, body, -1, { srMeta: { status, severity: isCritical ? 'critical' : 'normal', disposition: 'closed' } });
            }
            return result(config.alerts.closed, esc(status || 'Closed'), status || 'Closed', 999997, { srMeta: { status, severity: isCritical ? 'critical' : 'normal', disposition: 'closed' } });
        }
        if (!open || !expected) return { slaDays: 999996, rowClass: '', alertSeverity: '', text: '<span style="color:#ff9800">缺少SLA关键时间</span>', cleanText: '缺少SLA关键时间' };
        const deadline = suspended || expected;
        const total = deadline - open;
        const remaining = deadline - now;
        const remainingHours = Math.ceil(remaining / HOUR_MS);
        const remainingDays = Math.ceil(remaining / DAY_MS);
        const consume = total > 0 ? ((now - open) / total) * 100 : 100;
        const body = `剩余 ${formatDuration(remainingHours)} / 消耗 ${consume.toFixed(0)}%`;
        const extra = { deadline, srMeta: { status, severity: isCritical ? 'critical' : 'normal', disposition: 'active', consumeRate: Number.isFinite(consume) ? +consume.toFixed(2) : null, remainingHours, remainingDays } };
        if (remaining < 0 || upstreamOverdue) return result(config.alerts.overdue, `已超 ${formatDuration(Math.abs(remainingHours))}`, formatDuration(Math.abs(remainingHours)), remainingDays, extra);
        if (isCritical && (consume > config.thresholds.criticalDangerConsume || remainingHours < config.thresholds.criticalDangerHours)) return result(config.alerts.criticalDanger, body, body, remainingDays, extra);
        if (isCritical && consume > config.thresholds.criticalWarningConsume && remainingHours < config.thresholds.criticalWarningHours) return result(config.alerts.criticalWarning, body, body, remainingDays, extra);
        if (!isCritical && consume > config.thresholds.normalDangerConsume) return result(config.alerts.normalDanger, body, body, remainingDays, extra);
        if (!isCritical && consume > config.thresholds.normalWarningConsume) return result(config.alerts.normalWarning, body, body, remainingDays, extra);
        return { slaDays: remainingDays, rowClass: '', alertSeverity: '', text: body, cleanText: body, ...extra };
    }

    function evaluate(mode, row, options) { return mode === 'sr' ? evaluateSR(row, options) : evaluateStandard(mode, row, options); }
    function split(value) { return list(String(value || '').split(/[\n,，]/), []); }

    function renderAlert(level, ruleIndex, alertIndex) {
        return `<div class="risk-alert-card compact" data-rule-index="${ruleIndex}" data-alert-index="${alertIndex}">
            <label class="risk-editor-toggle"><input type="checkbox" data-field="enabled" ${level.enabled ? 'checked' : ''}>启用</label>
            <label><span>级别名称</span><input class="risk-editor-input" data-field="name" value="${esc(level.name)}" placeholder="级别名称"></label>
            <label><span>剩余天数 ≤</span><input type="number" class="risk-editor-input" data-field="maxDays" value="${level.maxDays}"></label>
            <label><span>告警类型</span><select class="risk-editor-input" data-field="severity">${['danger','warning','info'].map(v => `<option value="${v}" ${level.severity === v ? 'selected' : ''}>${v === 'danger' ? '红色紧急' : v === 'warning' ? '提醒' : '蓝色提示'}</option>`).join('')}</select></label>
            <label><span>标签后缀</span><input class="risk-editor-input" data-field="badgeSuffix" value="${esc(level.badgeSuffix)}"></label>
            <label class="risk-editor-color-field"><span>标签颜色</span><input type="color" data-field="color" value="${esc(level.color)}" title="标签颜色"></label>
            <button type="button" class="risk-editor-icon-btn danger" data-action="remove-alert">删除</button>
        </div>`;
    }
    function renderRule(rule, index) {
        return `<article class="risk-rule-card" data-rule-index="${index}">
            <div class="risk-editor-card-head"><label class="risk-editor-toggle"><input type="checkbox" data-field="enabled" ${rule.enabled ? 'checked' : ''}> 启用</label><input class="risk-editor-input risk-rule-name" data-field="name" value="${esc(rule.name)}"><button type="button" class="risk-editor-icon-btn danger" data-action="remove-rule">删除规则</button></div>
            <div class="risk-editor-rule-sections">
                <section class="risk-editor-subsection">
                    <div class="risk-editor-subsection-title"><b>状态识别</b><span>确定哪些数据进入本规则</span></div>
                    <div class="risk-editor-grid risk-editor-grid-match">
                        <label><span>状态条件</span><select class="risk-editor-input" data-field="operator">${[['equals','精确等于'],['contains','包含关键字'],['regex','正则表达式']].map(([v,l]) => `<option value="${v}" ${rule.match.operator === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
                        <div class="risk-editor-wide">${window.SLARulePicker.renderPicker({ mode: editorMode, id: `other-rule-values-${index}`, kind: 'value', label: '匹配值（来自所选状态字段）', selected: rule.match.values, fields: workingConfig.statusFields })}</div>
                        <label class="risk-editor-check"><span>匹配方式</span><span class="risk-editor-checkbox-control"><input type="checkbox" data-field="caseSensitive" ${rule.match.caseSensitive ? 'checked' : ''}><span>区分大小写</span></span></label>
                    </div>
                </section>
                <section class="risk-editor-subsection">
                    <div class="risk-editor-subsection-title"><b>截止日期</b><span>设置日期来源和计算方式</span></div>
                    <div class="risk-editor-grid risk-editor-grid-deadline">
                        <label><span>截止日期类型</span><select class="risk-editor-input" data-field="deadlineType"><option value="date_field" ${rule.deadline.type === 'date_field' ? 'selected' : ''}>直接使用日期字段</option><option value="field_plus_days" ${rule.deadline.type === 'field_plus_days' ? 'selected' : ''}>日期字段 + 固定天数</option></select></label>
                        <div class="risk-editor-wide">${window.SLARulePicker.renderPicker({ mode: editorMode, id: `other-rule-date-fields-${index}`, kind: 'field', label: '日期字段优先级', selected: rule.deadline.fields })}</div>
                        <label><span>追加天数</span><input type="number" class="risk-editor-input" data-field="offsetDays" value="${rule.deadline.offsetDays}"></label>
                    </div>
                </section>
                <section class="risk-editor-subsection risk-editor-subsection-compact">
                    <div class="risk-editor-subsection-title"><b>标签展示</b><span>配置表格中的告警文字</span></div>
                    <label><span>告警标签前缀</span><input class="risk-editor-input" data-field="badgePrefix" value="${esc(rule.badgePrefix)}"></label>
                </section>
            </div>
            <div class="other-rule-alert-head"><b>本规则告警分级</b><button type="button" class="risk-editor-add-btn" data-action="add-alert">+新增级别</button></div>
            <div class="other-rule-alert-list">${rule.alertLevels.map((level, i) => renderAlert(level, index, i)).join('')}</div>
        </article>`;
    }
    function renderStandardEditor(mode, config) {
        return `<div class="risk-rule-editor"><section class="risk-editor-global"><div><h4>状态识别入口</h4><p>按顺序取第一个非空字段；绿色候选表示当前导入表中真实存在。</p></div><div>${window.SLARulePicker.renderPicker({ mode, id: 'other-status-fields', kind: 'field', label: '状态字段优先级', selected: config.statusFields })}</div></section><section class="risk-editor-pane"><div class="risk-editor-pane-head"><div><h4>识别规则与告警分级</h4><p>每条识别规则可单独设置任意多个告警级别。</p></div><button type="button" class="risk-editor-add-btn" data-action="add-rule">+新增识别规则</button></div><div id="other-rule-list">${config.rules.map(renderRule).join('')}</div></section></div>`;
    }

    const FIELD_LABELS = { status:'状态字段',severity:'严重等级字段',overdue:'上游超期字段',openDate:'开单时间字段',expectedClose:'期望关单字段',suspendedClose:'挂起后截止字段',actualClose:'实际关单字段' };
    const VALUE_LABELS = { pending:'挂起状态关键字',closed:'已关闭状态关键字',critical:'Critical 等级关键字',overdue:'上游超期取值' };
    const THRESHOLD_LABELS = { criticalDangerConsume:'Critical 紧急：消耗率 > (%)',criticalDangerHours:'Critical 紧急：剩余小时 <',criticalWarningConsume:'Critical 提醒：消耗率 > (%)',criticalWarningHours:'Critical 提醒：剩余小时 <',normalDangerConsume:'普通紧急：消耗率 > (%)',normalWarningConsume:'普通提醒：消耗率 > (%)' };
    const ALERT_LABELS = { overdue:'在途超期',criticalDanger:'Critical 紧急',criticalWarning:'Critical 提醒',normalDanger:'普通紧急',normalWarning:'普通提醒',pending:'挂起忽略',closed:'已关单',suspendedGood:'挂起后未超期',suspendedOverdue:'挂起后超期',historicalOverdue:'历史超期' };
    function renderSREditor(config) {
        const fieldInputs = Object.keys(config.fields).map(key => `<div>${window.SLARulePicker.renderPicker({ mode: 'sr', id: `sr-fields-${key}`, kind: 'field', label: FIELD_LABELS[key], selected: config.fields[key] })}</div>`).join('');
        const valueFieldMap = { pending: config.fields.status, closed: config.fields.status, critical: config.fields.severity, overdue: config.fields.overdue };
        const valueInputs = Object.keys(config.values).map(key => `<div>${window.SLARulePicker.renderPicker({ mode: 'sr', id: `sr-values-${key}`, kind: 'value', label: VALUE_LABELS[key], selected: config.values[key], fields: valueFieldMap[key] })}</div>`).join('');
        const thresholds = Object.keys(config.thresholds).map(key => `<label><span>${THRESHOLD_LABELS[key]}</span><input type="number" class="risk-editor-input" data-sr-group="thresholds" data-sr-key="${key}" value="${config.thresholds[key]}"></label>`).join('');
        const alerts = Object.keys(config.alerts).map(key => { const item=config.alerts[key]; return `<div class="sr-alert-config"><label class="risk-editor-toggle"><input type="checkbox" data-sr-alert="${key}" data-field="enabled" ${item.enabled?'checked':''}>启用</label><b>${ALERT_LABELS[key]}</b><label><span>展示标签</span><input class="risk-editor-input" data-sr-alert="${key}" data-field="label" value="${esc(item.label)}"></label><label><span>告警类型</span><select class="risk-editor-input" data-sr-alert="${key}" data-field="severity">${[['danger','红色紧急'],['warning','提醒'],['info','蓝色提示'],['none','仅显示标签']].map(([v,l])=>`<option value="${v}" ${item.severity===v?'selected':''}>${l}</option>`).join('')}</select></label><label class="risk-editor-color-field"><span>标签颜色</span><input type="color" data-sr-alert="${key}" data-field="color" value="${item.color}"></label></div>`; }).join('');
        return `<div class="risk-rule-editor sr-rule-editor"><div class="risk-editor-columns"><section class="risk-editor-pane"><h4>字段与状态条件</h4><p>字段和值均取自当前 SR 导入数据；表内存在的候选会显示实际行数。</p><div class="sr-editor-grid">${fieldInputs}${valueInputs}</div></section><section class="risk-editor-pane"><h4>预警阈值</h4><p>紧急条件使用“或”，Critical 提醒使用“且”，与当前默认规则一致。</p><div class="sr-editor-grid">${thresholds}</div><h4>告警类型与展示</h4><div class="sr-alert-list">${alerts}</div></section></div></div>`;
    }

    function renderEditor(mode, config) { editorMode = mode; workingConfig = normalizeConfig(mode, config); return mode === 'sr' ? renderSREditor(workingConfig) : renderStandardEditor(mode, workingConfig); }
    function collectStandard() {
        const rules = Array.from(document.querySelectorAll('#other-rule-list > .risk-rule-card')).map((card, index) => {
            const levels = Array.from(card.querySelectorAll('.other-rule-alert-list .risk-alert-card')).map((level, i) => ({ id: workingConfig.rules[index]?.alertLevels[i]?.id || `alert-${Date.now()}-${i}`, enabled: level.querySelector('[data-field="enabled"]').checked, name: level.querySelector('[data-field="name"]').value, maxDays: level.querySelector('[data-field="maxDays"]').value, severity: level.querySelector('[data-field="severity"]').value, badgeSuffix: level.querySelector('[data-field="badgeSuffix"]').value, color: level.querySelector('[data-field="color"]').value }));
            return { id: workingConfig.rules[index]?.id || `rule-${Date.now()}-${index}`, enabled: card.querySelector(':scope > .risk-editor-card-head [data-field="enabled"]').checked, name: card.querySelector(':scope > .risk-editor-card-head [data-field="name"]').value, badgePrefix: card.querySelector('[data-field="badgePrefix"]').value, match: { operator: card.querySelector('[data-field="operator"]').value, values: window.SLARulePicker.collect(`other-rule-values-${index}`), caseSensitive: card.querySelector('[data-field="caseSensitive"]').checked }, deadline: { type: card.querySelector('[data-field="deadlineType"]').value, fields: window.SLARulePicker.collect(`other-rule-date-fields-${index}`), offsetDays: card.querySelector('[data-field="offsetDays"]').value }, alertLevels: levels };
        });
        return normalizeStandard(editorMode, { statusFields: window.SLARulePicker.collect('other-status-fields'), rules });
    }
    function collectSR() {
        const raw = clone(workingConfig);
        Object.keys(raw.fields).forEach(key => { raw.fields[key] = window.SLARulePicker.collect(`sr-fields-${key}`); });
        Object.keys(raw.values).forEach(key => { raw.values[key] = window.SLARulePicker.collect(`sr-values-${key}`); });
        document.querySelectorAll('[data-sr-group="thresholds"]').forEach(input => { raw.thresholds[input.dataset.srKey] = input.value; });
        Object.keys(raw.alerts).forEach(key => { const find = field => document.querySelector(`[data-sr-alert="${key}"][data-field="${field}"]`); raw.alerts[key] = { enabled: find('enabled').checked, label: find('label').value, severity: find('severity').value, color: find('color').value }; });
        return normalizeSR(raw);
    }
    function collectEditor() { return editorMode === 'sr' ? collectSR() : collectStandard(); }
    function validate(config) {
        if (editorMode === 'sr') {
            Object.entries(config.fields).forEach(([key, values]) => { if (!values.length) throw new Error(`${FIELD_LABELS[key]}至少配置一列`); });
            return;
        }
        if (!config.statusFields.length) throw new Error('至少配置一个状态字段');
        if (!config.rules.some(rule => rule.enabled)) throw new Error('至少启用一条识别规则');
        config.rules.forEach(rule => { if (!rule.name || !rule.match.values.length || !rule.deadline.fields.length) throw new Error('每条规则都必须填写名称、匹配值和日期字段'); if (!rule.alertLevels.some(level => level.enabled)) throw new Error(`“${rule.name}”至少启用一个告警级别`); if (rule.match.operator === 'regex') rule.match.values.forEach(value => { try { new RegExp(value); } catch (_) { throw new Error(`正则表达式无效：${value}`); } }); });
    }
    function refresh() { const body=document.getElementById('section-rule-config-body'); if(body) body.innerHTML=renderEditor(editorMode,workingConfig); bindEditor(); }
    function show(message, error=false) { const status=document.getElementById('section-rule-config-status'); if(status){status.textContent=message;status.classList.toggle('error',error);} }
    function bindEditor() {
        const body=document.getElementById('section-rule-config-body'); if(!body)return;
        body.onchange=event=>{ window.SLARulePicker.handleChoiceChange(event.target);if(event.target.closest('.rule-data-picker[data-picker-kind="field"]')){workingConfig=collectEditor();refresh();} };
        body.onclick=event=>{ const button=event.target.closest('[data-action]'); if(!button)return; workingConfig=collectEditor(); const action=button.dataset.action; const card=button.closest('.risk-rule-card'); const ruleIndex=card?Number(card.dataset.ruleIndex):-1;
            if(action==='add-rule') workingConfig.rules.push(normalizeRule({name:'新识别规则',match:{values:['新状态']},deadline:{fields:['create_time']},alertLevels:[{name:'提醒',maxDays:30,severity:'warning',badgeSuffix:'提醒',color:'#7b1fa2'}]},null,workingConfig.rules.length));
            if(action==='remove-rule'){if(workingConfig.rules.length<=1)return show('至少保留一条识别规则',true);workingConfig.rules.splice(ruleIndex,1);}
            if(action==='add-alert') workingConfig.rules[ruleIndex].alertLevels.push(normalizeAlert({name:'新级别',maxDays:60,severity:'info',badgeSuffix:'提示',color:'#1976d2'},null,workingConfig.rules[ruleIndex].alertLevels.length));
            if(action==='remove-alert'){const ai=Number(button.closest('.risk-alert-card').dataset.alertIndex);if(workingConfig.rules[ruleIndex].alertLevels.length<=1)return show('至少保留一个告警级别',true);workingConfig.rules[ruleIndex].alertLevels.splice(ai,1);} refresh(); };
    }
    function prepareEditor(mode, config) { editorMode=mode;workingConfig=normalizeConfig(mode,config);refresh(); }
    async function saveFromEditor() {
        try { const config=collectEditor();validate(config);show('正在保存并重算当前数据…');await API.put(`/api/sla/prefs/${encodeURIComponent(prefKey(editorMode))}`,config);cache[editorMode]=normalizeConfig(editorMode,config);workingConfig=clone(cache[editorMode]);if(window.SLASection?.applySectionRuleConfig)window.SLASection.applySectionRuleConfig(editorMode,cache[editorMode]);window.SLAMetricSnapshotSync?.schedule();prepareEditor(editorMode,cache[editorMode]);show(`已保存，当前${MODE_META[editorMode].name}已按新规则重算`);if(window.showToast)window.showToast(`✅ ${MODE_META[editorMode].name}规则已保存并应用`); } catch(error){show(error.message||'保存失败',true);}
    }
    function resetEditor() { if(!confirm(`确定将${MODE_META[editorMode].name}规则恢复为默认值吗？\n点击“保存并应用”后才会写入服务端。`))return;workingConfig=defaultConfig(editorMode);refresh();show('已恢复默认值，尚未保存'); }
    function describeConfig(mode, config) {
        const normalized=normalizeConfig(mode,config||cache[mode]||defaultConfig(mode));
        if(mode==='sr')return [`状态字段：${normalized.fields.status.join(' -> ')}`,`挂起关键字：${normalized.values.pending.join(' / ')}`,`关闭关键字：${normalized.values.closed.join(' / ')}`,`Critical：消耗 > ${normalized.thresholds.criticalDangerConsume}% 或剩余 < ${normalized.thresholds.criticalDangerHours}小时；提醒：消耗 > ${normalized.thresholds.criticalWarningConsume}% 且剩余 < ${normalized.thresholds.criticalWarningHours}小时`,`普通单：消耗 > ${normalized.thresholds.normalDangerConsume}% 紧急，> ${normalized.thresholds.normalWarningConsume}% 提醒`];
        const items=[`状态字段优先级：${normalized.statusFields.join(' -> ')}`];normalized.rules.filter(r=>r.enabled).forEach(r=>items.push(`${r.name}：${r.match.values.join(' / ')}；${r.deadline.fields.join(' -> ')}${r.deadline.type==='field_plus_days'?` + ${r.deadline.offsetDays}天`:''}；${r.alertLevels.filter(l=>l.enabled).map(l=>`${l.name} <= ${l.maxDays}天`).join(' / ')}`));return items;
    }

    window.SLAOtherRules={ SUPPORTED_MODES, MODE_META, loadConfig, normalizeConfig, evaluate, renderEditor, prepareEditor, saveFromEditor, resetEditor, describeConfig, defaultConfig };
})();
