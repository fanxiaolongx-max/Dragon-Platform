/**
 * sla/risk-rules.js - 常规风险内置规则的配置、持久化与执行引擎
 */
(function () {
    const PREF_KEY = 'sla_builtin_rule_risk_v1';
    const API_PATH = `/api/sla/prefs/${PREF_KEY}`;
    const MATCH_OPERATORS = new Set(['equals', 'contains', 'regex']);
    const DEADLINE_TYPES = new Set(['date_field', 'field_plus_days']);
    const SEVERITIES = new Set(['danger', 'warning', 'info']);
    let cachedConfig = null;
    let workingConfig = null;

    const DEFAULT_CONFIG = {
        version: 1,
        statusFields: ['风险状态', 'risk_status'],
        rules: [
            {
                id: 'risk-confirming', enabled: true, name: 'Risk Confirming', badgePrefix: 'Confirm',
                match: { operator: 'equals', values: ['Risk Confirming'], caseSensitive: false },
                deadline: { type: 'field_plus_days', fields: ['创单时间', 'create_time_new', 'create_time'], offsetDays: 30 }
            },
            {
                id: 'risk-open', enabled: true, name: 'Risk Open', badgePrefix: 'Open',
                match: { operator: 'equals', values: ['Risk Open'], caseSensitive: false },
                deadline: { type: 'date_field', fields: ['ticket_close_due_date', '期望关闭时间', 'due_time'], offsetDays: 0 }
            },
            {
                id: 'risk-suspended', enabled: true, name: 'Risk Suspended', badgePrefix: 'Suspend',
                match: { operator: 'equals', values: ['Risk Suspended'], caseSensitive: false },
                deadline: { type: 'date_field', fields: ['ticket_close_due_date', '期望关闭时间', 'due_time', '期望关闭时间-挂起', 'suspend_due_date'], offsetDays: 0 }
            },
            {
                id: 'complete-reviewing', enabled: true, name: 'Complete Reviewing', badgePrefix: 'Review',
                match: { operator: 'equals', values: ['Complete Reviewing'], caseSensitive: false },
                deadline: { type: 'date_field', fields: ['ticket_close_due_date', '期望关闭时间', 'due_time'], offsetDays: 0 }
            }
        ],
        alertLevels: [
            { id: 'danger', enabled: true, name: '红色紧急', maxDays: 10, severity: 'danger', badgeSuffix: '紧急', color: '#d32f2f' },
            { id: 'warning', enabled: true, name: '紫色提醒', maxDays: 29, severity: 'warning', badgeSuffix: '提醒', color: '#673ab7' }
        ]
    };

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function clampNumber(value, fallback, min, max) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.min(max, Math.max(min, Math.trunc(parsed)));
    }

    function normalizeList(value, fallback = []) {
        const source = Array.isArray(value) ? value : String(value || '').split(/[\n,，]/);
        const result = Array.from(new Set(source.map(item => String(item || '').trim()).filter(Boolean)));
        return result.length ? result.slice(0, 30) : clone(fallback);
    }

    function safeId(value, fallback) {
        const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
        return normalized.slice(0, 80) || fallback;
    }

    function normalizeRule(rule, index) {
        const source = rule && typeof rule === 'object' ? rule : {};
        const match = source.match && typeof source.match === 'object' ? source.match : {};
        const deadline = source.deadline && typeof source.deadline === 'object' ? source.deadline : {};
        const operator = MATCH_OPERATORS.has(match.operator) ? match.operator : 'equals';
        const deadlineType = DEADLINE_TYPES.has(deadline.type) ? deadline.type : 'date_field';
        const name = String(source.name || `识别规则 ${index + 1}`).trim().slice(0, 100);
        return {
            id: safeId(source.id, `risk-rule-${index + 1}`),
            enabled: source.enabled !== false,
            name,
            badgePrefix: String(source.badgePrefix || name).trim().slice(0, 40),
            match: {
                operator,
                values: normalizeList(match.values, [name]),
                caseSensitive: match.caseSensitive === true
            },
            deadline: {
                type: deadlineType,
                fields: normalizeList(deadline.fields, ['ticket_close_due_date']),
                offsetDays: deadlineType === 'field_plus_days'
                    ? clampNumber(deadline.offsetDays, 30, -3650, 3650)
                    : 0
            }
        };
    }

    function normalizeAlertLevel(level, index) {
        const source = level && typeof level === 'object' ? level : {};
        const severity = SEVERITIES.has(source.severity) ? source.severity : 'warning';
        const fallbackColor = severity === 'danger' ? '#d32f2f' : (severity === 'info' ? '#1976d2' : '#673ab7');
        const color = /^#[0-9a-f]{6}$/i.test(String(source.color || '')) ? String(source.color) : fallbackColor;
        return {
            id: safeId(source.id, `alert-level-${index + 1}`),
            enabled: source.enabled !== false,
            name: String(source.name || `告警级别 ${index + 1}`).trim().slice(0, 80),
            maxDays: clampNumber(source.maxDays, index === 0 ? 10 : 29, -3650, 36500),
            severity,
            badgeSuffix: String(source.badgeSuffix || '提醒').trim().slice(0, 30),
            color
        };
    }

    function normalizeConfig(config) {
        const source = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
        const rules = (Array.isArray(source.rules) ? source.rules : DEFAULT_CONFIG.rules).slice(0, 20).map(normalizeRule);
        const alertLevels = (Array.isArray(source.alertLevels) ? source.alertLevels : DEFAULT_CONFIG.alertLevels).slice(0, 10).map(normalizeAlertLevel);
        return {
            version: 1,
            statusFields: normalizeList(source.statusFields, DEFAULT_CONFIG.statusFields),
            rules: rules.length ? rules : clone(DEFAULT_CONFIG.rules),
            alertLevels: alertLevels.length ? alertLevels : clone(DEFAULT_CONFIG.alertLevels)
        };
    }

    async function loadConfig(options = {}) {
        if (cachedConfig && !options.force) return clone(cachedConfig);
        try {
            const saved = await API.get(API_PATH);
            cachedConfig = normalizeConfig(saved || DEFAULT_CONFIG);
        } catch (error) {
            cachedConfig = normalizeConfig(DEFAULT_CONFIG);
        }
        return clone(cachedConfig);
    }

    function getConfig() {
        return clone(cachedConfig || normalizeConfig(DEFAULT_CONFIG));
    }

    function escapeText(value) {
        return typeof window.escapeHTML === 'function'
            ? window.escapeHTML(String(value || ''))
            : String(value || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
    }

    function matchesStatus(status, match) {
        const rawStatus = String(status || '');
        const values = normalizeList(match.values, []);
        const caseSensitive = match.caseSensitive === true;
        const candidate = caseSensitive ? rawStatus : rawStatus.toLowerCase();
        return values.some(value => {
            const expected = caseSensitive ? value : value.toLowerCase();
            if (match.operator === 'contains') return candidate.includes(expected);
            if (match.operator === 'regex') {
                try { return new RegExp(value, caseSensitive ? '' : 'i').test(rawStatus); }
                catch (error) { return false; }
            }
            return candidate === expected;
        });
    }

    function firstValue(row, fields) {
        for (const field of fields || []) {
            const value = row && row[field];
            if (value !== undefined && value !== null && String(value).trim() !== '') {
                return { field, value: String(value).trim() };
            }
        }
        return { field: '', value: '' };
    }

    function evaluate(row, options = {}) {
        const config = normalizeConfig(options.config || cachedConfig || DEFAULT_CONFIG);
        const statusResult = firstValue(row, config.statusFields);
        const status = statusResult.value;
        const rule = config.rules.find(item => item.enabled && matchesStatus(status, item.match));
        if (!rule) return null;

        const dateResult = firstValue(row, rule.deadline.fields);
        if (!dateResult.value) {
            return {
                matched: true,
                status,
                rule,
                missingDate: true,
                slaDays: 999995,
                rowClass: '',
                alertSeverity: '',
                text: `<span style="color:#ff9800">缺少截止日期</span> ${escapeText(rule.name)}`,
                cleanText: `缺少截止日期 (${rule.name})`
            };
        }

        const parseDate = typeof options.parseDate === 'function'
            ? options.parseDate
            : value => {
                const date = new Date(value);
                return isNaN(date) ? null : date;
            };
        const parsedDate = parseDate(dateResult.value, dateResult.field, rule);
        if (!parsedDate) {
            return {
                matched: true,
                status,
                rule,
                parseFailed: true,
                slaDays: -999999,
                rowClass: '',
                alertSeverity: '',
                text: '<span style="color:red">解析失败</span>',
                cleanText: '日期解析失败'
            };
        }

        const deadline = new Date(parsedDate);
        if (rule.deadline.type === 'field_plus_days') deadline.setDate(deadline.getDate() + rule.deadline.offsetDays);
        const now = options.now instanceof Date ? options.now : new Date();
        const slaDays = Math.ceil((deadline - now) / 86400000);
        const base = `剩余 ${slaDays} 天`;
        const alertLevel = config.alertLevels
            .filter(level => level.enabled)
            .sort((a, b) => a.maxDays - b.maxDays)
            .find(level => slaDays <= level.maxDays);
        if (!alertLevel) {
            return { matched: true, status, rule, deadline, slaDays, rowClass: '', alertSeverity: '', text: base, cleanText: base };
        }

        const rowClass = alertLevel.severity === 'danger'
            ? 'danger-row'
            : (alertLevel.severity === 'info' ? 'info-row' : 'warning-row');
        const badgeText = `${rule.badgePrefix}${alertLevel.badgeSuffix}`;
        const safeColor = escapeText(alertLevel.color);
        const safeBadge = escapeText(badgeText);
        return {
            matched: true,
            status,
            rule,
            deadline,
            alertLevel,
            slaDays,
            rowClass,
            alertSeverity: alertLevel.severity,
            text: `<span class="badge risk-config-badge" style="background:${safeColor} !important;color:#fff !important;">${safeBadge}</span> ${base}`,
            cleanText: `${badgeText} (${base})`
        };
    }

    function splitEditorList(value) {
        return normalizeList(String(value || '').split(/[\n,，]/), []);
    }

    function renderRuleCard(rule, index) {
        const operatorOptions = [
            ['equals', '精确等于'], ['contains', '包含关键字'], ['regex', '正则表达式']
        ].map(([value, label]) => `<option value="${value}" ${rule.match.operator === value ? 'selected' : ''}>${label}</option>`).join('');
        const deadlineOptions = [
            ['date_field', '直接使用日期字段'], ['field_plus_days', '日期字段 + 固定天数']
        ].map(([value, label]) => `<option value="${value}" ${rule.deadline.type === value ? 'selected' : ''}>${label}</option>`).join('');
        return `
            <article class="risk-rule-card" data-rule-index="${index}">
                <div class="risk-editor-card-head">
                    <label class="risk-editor-toggle"><input type="checkbox" data-field="enabled" ${rule.enabled ? 'checked' : ''}> 启用</label>
                    <input class="risk-editor-input risk-rule-name" data-field="name" value="${escapeText(rule.name)}" placeholder="规则名称">
                    <button type="button" class="risk-editor-icon-btn danger" data-action="remove-rule" title="删除识别规则">删除</button>
                </div>
                <div class="risk-editor-rule-sections">
                    <section class="risk-editor-subsection">
                        <div class="risk-editor-subsection-title"><b>状态识别</b><span>确定哪些数据进入本规则</span></div>
                        <div class="risk-editor-grid risk-editor-grid-match">
                            <label><span>状态条件</span><select class="risk-editor-input" data-field="operator">${operatorOptions}</select></label>
                            <div class="risk-editor-wide">${window.SLARulePicker.renderPicker({ mode: 'risk', id: `risk-rule-values-${index}`, kind: 'value', label: '匹配值（来自所选状态字段）', selected: rule.match.values, fields: workingConfig.statusFields })}</div>
                            <label class="risk-editor-check"><span>匹配方式</span><span class="risk-editor-checkbox-control"><input type="checkbox" data-field="caseSensitive" ${rule.match.caseSensitive ? 'checked' : ''}><span>区分大小写</span></span></label>
                        </div>
                    </section>
                    <section class="risk-editor-subsection">
                        <div class="risk-editor-subsection-title"><b>截止日期</b><span>设置日期来源和计算方式</span></div>
                        <div class="risk-editor-grid risk-editor-grid-deadline">
                            <label><span>截止日期类型</span><select class="risk-editor-input" data-field="deadlineType">${deadlineOptions}</select></label>
                            <div class="risk-editor-wide">${window.SLARulePicker.renderPicker({ mode: 'risk', id: `risk-rule-date-fields-${index}`, kind: 'field', label: '日期字段优先级', selected: rule.deadline.fields })}</div>
                            <label><span>追加天数</span><input type="number" class="risk-editor-input" data-field="offsetDays" value="${rule.deadline.offsetDays}" ${rule.deadline.type === 'field_plus_days' ? '' : 'disabled'}></label>
                        </div>
                    </section>
                    <section class="risk-editor-subsection risk-editor-subsection-compact">
                        <div class="risk-editor-subsection-title"><b>标签展示</b><span>配置表格中的告警文字</span></div>
                        <label><span>告警标签前缀</span><input class="risk-editor-input" data-field="badgePrefix" value="${escapeText(rule.badgePrefix)}" placeholder="例如 Review"></label>
                    </section>
                </div>
            </article>`;
    }

    function renderAlertCard(level, index) {
        const severityOptions = [
            ['danger', '红色紧急'], ['warning', '黄/紫色提醒'], ['info', '蓝色提示']
        ].map(([value, label]) => `<option value="${value}" ${level.severity === value ? 'selected' : ''}>${label}</option>`).join('');
        return `
            <article class="risk-alert-card" data-alert-index="${index}">
                <div class="risk-editor-card-head">
                    <label class="risk-editor-toggle"><input type="checkbox" data-field="enabled" ${level.enabled ? 'checked' : ''}> 启用</label>
                    <input class="risk-editor-input" data-field="name" value="${escapeText(level.name)}" placeholder="级别名称">
                    <button type="button" class="risk-editor-icon-btn danger" data-action="remove-alert" title="删除告警级别">删除</button>
                </div>
                <div class="risk-alert-grid">
                    <label><span>剩余天数 ≤</span><input type="number" class="risk-editor-input" data-field="maxDays" value="${level.maxDays}"></label>
                    <label><span>告警类型</span><select class="risk-editor-input" data-field="severity">${severityOptions}</select></label>
                    <label><span>标签后缀</span><input class="risk-editor-input" data-field="badgeSuffix" value="${escapeText(level.badgeSuffix)}"></label>
                    <label><span>标签颜色</span><input type="color" class="risk-editor-color" data-field="color" value="${escapeText(level.color)}"></label>
                </div>
            </article>`;
    }

    function buildPreview(config) {
        const enabledRules = config.rules.filter(rule => rule.enabled);
        const enabledLevels = config.alertLevels.filter(level => level.enabled).sort((a, b) => a.maxDays - b.maxDays);
        const ruleLines = enabledRules.map(rule => {
            const operator = rule.match.operator === 'equals' ? '等于' : (rule.match.operator === 'contains' ? '包含' : '匹配正则');
            const deadline = rule.deadline.type === 'field_plus_days'
                ? `${rule.deadline.fields.join(' → ')} + ${rule.deadline.offsetDays} 天`
                : rule.deadline.fields.join(' → ');
            return `<li><b>${escapeText(rule.name)}</b>：状态${operator} ${escapeText(rule.match.values.join(' / '))}；截止日期 ${escapeText(deadline)}</li>`;
        }).join('');
        const levelLines = enabledLevels.map(level =>
            `<span class="risk-preview-level" style="--risk-preview-color:${escapeText(level.color)}">${escapeText(level.name)} · 剩余 ≤ ${level.maxDays} 天</span>`
        ).join('');
        return `<div class="risk-rule-preview"><div><b>当前生效概览</b> · ${enabledRules.length} 条识别规则 / ${enabledLevels.length} 个告警级别</div><ul>${ruleLines || '<li>未启用任何识别规则</li>'}</ul><div class="risk-preview-levels">${levelLines || '<span>未启用任何告警级别</span>'}</div></div>`;
    }

    function renderEditor(config) {
        workingConfig = normalizeConfig(config || cachedConfig || DEFAULT_CONFIG);
        return `
            <div class="risk-rule-editor">
                <section class="risk-editor-global">
                    <div>
                        <h4>状态识别入口</h4>
                        <p>按顺序取第一个非空状态字段，再依次执行下方识别规则。</p>
                    </div>
                    <div>${window.SLARulePicker.renderPicker({ mode: 'risk', id: 'risk-status-fields', kind: 'field', label: '状态字段优先级', selected: workingConfig.statusFields })}</div>
                </section>
                <div class="risk-editor-columns">
                    <section class="risk-editor-pane">
                        <div class="risk-editor-pane-head"><div><h4>识别规则</h4><p>配置每个状态的匹配条件和截止日期算法。</p></div><button type="button" class="risk-editor-add-btn" data-action="add-rule">+新增识别规则</button></div>
                        <div id="risk-rule-card-list">${workingConfig.rules.map(renderRuleCard).join('')}</div>
                    </section>
                    <section class="risk-editor-pane risk-alert-pane">
                        <div class="risk-editor-pane-head"><div><h4>告警分级</h4><p>按“剩余天数 ≤ 阈值”从小到大匹配第一个级别。</p></div><button type="button" class="risk-editor-add-btn" data-action="add-alert">+新增告警级别</button></div>
                        <div id="risk-alert-card-list">${workingConfig.alertLevels.map(renderAlertCard).join('')}</div>
                    </section>
                </div>
                <div id="risk-rule-live-preview">${buildPreview(workingConfig)}</div>
            </div>`;
    }

    function collectEditorConfig() {
        const statusFields = window.SLARulePicker.collect('risk-status-fields');
        const rules = Array.from(document.querySelectorAll('#risk-rule-card-list .risk-rule-card')).map((card, index) => ({
            id: workingConfig.rules[index]?.id || `risk-rule-${Date.now()}-${index}`,
            enabled: card.querySelector('[data-field="enabled"]')?.checked === true,
            name: card.querySelector('[data-field="name"]')?.value || '',
            badgePrefix: card.querySelector('[data-field="badgePrefix"]')?.value || '',
            match: {
                operator: card.querySelector('[data-field="operator"]')?.value || 'equals',
                values: window.SLARulePicker.collect(`risk-rule-values-${index}`),
                caseSensitive: card.querySelector('[data-field="caseSensitive"]')?.checked === true
            },
            deadline: {
                type: card.querySelector('[data-field="deadlineType"]')?.value || 'date_field',
                fields: window.SLARulePicker.collect(`risk-rule-date-fields-${index}`),
                offsetDays: card.querySelector('[data-field="offsetDays"]')?.value || 0
            }
        }));
        const alertLevels = Array.from(document.querySelectorAll('#risk-alert-card-list .risk-alert-card')).map((card, index) => ({
            id: workingConfig.alertLevels[index]?.id || `alert-level-${Date.now()}-${index}`,
            enabled: card.querySelector('[data-field="enabled"]')?.checked === true,
            name: card.querySelector('[data-field="name"]')?.value || '',
            maxDays: card.querySelector('[data-field="maxDays"]')?.value || 0,
            severity: card.querySelector('[data-field="severity"]')?.value || 'warning',
            badgeSuffix: card.querySelector('[data-field="badgeSuffix"]')?.value || '',
            color: card.querySelector('[data-field="color"]')?.value || '#673ab7'
        }));
        return normalizeConfig({ version: 1, statusFields, rules, alertLevels });
    }

    function validateConfig(config) {
        if (!config.statusFields.length) throw new Error('至少配置一个状态字段');
        if (!config.rules.length) throw new Error('至少保留一条识别规则');
        if (!config.rules.some(rule => rule.enabled)) throw new Error('至少启用一条识别规则');
        if (!config.alertLevels.length) throw new Error('至少保留一个告警级别');
        if (!config.alertLevels.some(level => level.enabled)) throw new Error('至少启用一个告警级别');
        config.rules.forEach((rule, index) => {
            if (!rule.name) throw new Error(`第 ${index + 1} 条识别规则缺少名称`);
            if (!rule.match.values.length) throw new Error(`识别规则“${rule.name}”缺少匹配值`);
            if (!rule.deadline.fields.length) throw new Error(`识别规则“${rule.name}”缺少日期字段`);
            if (rule.match.operator === 'regex') {
                rule.match.values.forEach(value => {
                    try { new RegExp(value, rule.match.caseSensitive ? '' : 'i'); }
                    catch (error) { throw new Error(`识别规则“${rule.name}”的正则无效：${value}`); }
                });
            }
        });
    }

    function refreshEditor() {
        const body = document.getElementById('section-rule-config-body');
        if (!body) return;
        body.innerHTML = renderEditor(workingConfig);
        bindEditor();
    }

    function updatePreview() {
        try { workingConfig = collectEditorConfig(); } catch (error) { return; }
        const preview = document.getElementById('risk-rule-live-preview');
        if (preview) preview.innerHTML = buildPreview(workingConfig);
        document.querySelectorAll('#risk-rule-card-list .risk-rule-card').forEach(card => {
            const type = card.querySelector('[data-field="deadlineType"]')?.value;
            const offset = card.querySelector('[data-field="offsetDays"]');
            if (offset) offset.disabled = type !== 'field_plus_days';
        });
    }

    function bindEditor() {
        const body = document.getElementById('section-rule-config-body');
        if (!body) return;
        body.oninput = updatePreview;
        body.onchange = event => {
            window.SLARulePicker.handleChoiceChange(event.target);
            updatePreview();
            if (event.target.closest('.rule-data-picker[data-picker-kind="field"]')) {
                workingConfig = collectEditorConfig();
                refreshEditor();
            }
        };
        body.onclick = event => {
            const actionButton = event.target.closest('[data-action]');
            if (!actionButton) return;
            event.preventDefault();
            workingConfig = collectEditorConfig();
            const action = actionButton.dataset.action;
            if (action === 'add-rule') {
                workingConfig.rules.push(normalizeRule({
                    id: `risk-rule-${Date.now()}`, name: '新识别规则', badgePrefix: 'Risk',
                    match: { operator: 'equals', values: ['新状态'] },
                    deadline: { type: 'date_field', fields: ['ticket_close_due_date'] }
                }, workingConfig.rules.length));
            } else if (action === 'add-alert') {
                workingConfig.alertLevels.push(normalizeAlertLevel({
                    id: `alert-${Date.now()}`, name: '新告警级别', maxDays: 60,
                    severity: 'info', badgeSuffix: '提示', color: '#1976d2'
                }, workingConfig.alertLevels.length));
            } else if (action === 'remove-rule') {
                if (workingConfig.rules.length <= 1) return showMessage('至少保留一条识别规则', true);
                workingConfig.rules.splice(Number(actionButton.closest('.risk-rule-card')?.dataset.ruleIndex), 1);
            } else if (action === 'remove-alert') {
                if (workingConfig.alertLevels.length <= 1) return showMessage('至少保留一个告警级别', true);
                workingConfig.alertLevels.splice(Number(actionButton.closest('.risk-alert-card')?.dataset.alertIndex), 1);
            }
            refreshEditor();
        };
    }

    function showMessage(message, isError = false) {
        const status = document.getElementById('section-rule-config-status');
        if (!status) return;
        status.textContent = message;
        status.classList.toggle('error', isError);
    }

    function prepareEditor(config) {
        workingConfig = normalizeConfig(config || cachedConfig || DEFAULT_CONFIG);
        const body = document.getElementById('section-rule-config-body');
        if (body) body.innerHTML = renderEditor(workingConfig);
        bindEditor();
    }

    async function saveFromEditor() {
        try {
            const config = collectEditorConfig();
            validateConfig(config);
            showMessage('正在保存并重算当前数据…');
            await API.put(API_PATH, config);
            cachedConfig = normalizeConfig(config);
            workingConfig = clone(cachedConfig);
            if (window.SLASection && typeof window.SLASection.applyRiskRuleConfig === 'function') {
                window.SLASection.applyRiskRuleConfig(cachedConfig);
            }
            window.SLAMetricSnapshotSync?.schedule();
            prepareEditor(cachedConfig);
            showMessage('已保存，当前常规风险表已按新规则重算');
            if (typeof window.showToast === 'function') window.showToast('✅ 常规风险规则已保存并应用');
        } catch (error) {
            showMessage(error.message || '保存失败', true);
        }
    }

    function resetEditor() {
        if (!confirm('确定将当前弹窗内的常规风险规则恢复为默认值吗？\n点击“保存并应用”后才会写入服务端。')) return;
        workingConfig = normalizeConfig(DEFAULT_CONFIG);
        refreshEditor();
        showMessage('已恢复默认值，尚未保存');
    }

    function describeConfig(config) {
        const normalized = normalizeConfig(config || cachedConfig || DEFAULT_CONFIG);
        const items = [
            `状态字段优先级：${normalized.statusFields.join(' -> ')}`
        ];
        normalized.rules.filter(rule => rule.enabled).forEach(rule => {
            const deadline = rule.deadline.type === 'field_plus_days'
                ? `${rule.deadline.fields.join(' -> ')} + ${rule.deadline.offsetDays}天`
                : rule.deadline.fields.join(' -> ');
            items.push(`${rule.name}：${rule.match.values.join(' / ')}；${deadline}`);
        });
        items.push(`告警分级：${normalized.alertLevels.filter(level => level.enabled).sort((a, b) => a.maxDays - b.maxDays).map(level => `${level.name} <= ${level.maxDays}天`).join('；')}`);
        return items;
    }

    window.SLARiskRules = {
        PREF_KEY,
        DEFAULT_CONFIG: clone(DEFAULT_CONFIG),
        normalizeConfig,
        loadConfig,
        getConfig,
        evaluate,
        renderEditor,
        prepareEditor,
        saveFromEditor,
        resetEditor,
        describeConfig
    };
})();
