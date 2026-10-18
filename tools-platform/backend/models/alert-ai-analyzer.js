const { all, run } = require('./app-db');
const aiSettingsRepo = require('./ai-settings-repository');
const alertCenterRepo = require('./alert-center-repository');
const aiProviderClient = require('./ai-provider-client');
const { alertAiCircuit } = require('./ai-circuit-breaker');

const MAX_PER_MINUTE = 3;
const MAX_PER_HOUR = 30;
const MAX_QUEUE_SIZE = 300;
const MAX_DETAIL_CHARS = 5000;

const queue = [];
const minuteHits = [];
const hourHits = [];
let processing = false;
let startupScheduled = false;

function pruneHits(now = Date.now()) {
    while (minuteHits.length && minuteHits[0] <= now - 60 * 1000) minuteHits.shift();
    while (hourHits.length && hourHits[0] <= now - 60 * 60 * 1000) hourHits.shift();
}

function canUseAi(now = Date.now()) {
    pruneHits(now);
    return minuteHits.length < MAX_PER_MINUTE && hourHits.length < MAX_PER_HOUR;
}

function getRateLimitDelay(now = Date.now()) {
    pruneHits(now);
    const minuteDelay = minuteHits.length >= MAX_PER_MINUTE
        ? Math.max(1000, minuteHits[0] + 60 * 1000 - now + 500)
        : 1000;
    const hourDelay = hourHits.length >= MAX_PER_HOUR
        ? Math.max(1000, hourHits[0] + 60 * 60 * 1000 - now + 500)
        : 1000;
    return Math.max(minuteDelay, hourDelay);
}

function markAiUsed(now = Date.now()) {
    minuteHits.push(now);
    hourHits.push(now);
}

function compactJson(value, maxChars = MAX_DETAIL_CHARS) {
    try {
        return JSON.stringify(value || {}, null, 2).slice(0, maxChars);
    } catch (_err) {
        return String(value || '').slice(0, maxChars);
    }
}

function cleanAiText(value) {
    return String(value || '')
        .replace(/^```(?:text|markdown)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
}

function describePageFromRequest(request = {}) {
    const text = `${request.referer || ''} ${request.path || ''}`.toLowerCase();
    if (text.includes('/sla')) return 'SLA页面';
    if (text.includes('/uivf12')) return 'UIVF12页面';
    if (text.includes('/report')) return '报表看板';
    if (text.includes('/db')) return '数据舱';
    return '系统页面';
}

function compactLabelList(labels = []) {
    const safe = Array.isArray(labels) ? labels.filter(Boolean).map(String) : [];
    if (!safe.length) return '';
    const picked = safe.slice(0, 3).map(item => `“${item}”`).join('、');
    return safe.length > 3 ? `${picked}等${safe.length}项` : picked;
}

function compactChangedFieldList(fields = []) {
    const safe = Array.isArray(fields) ? fields.filter(Boolean) : [];
    if (!safe.length) return '';
    const picked = safe.slice(0, 4).map(item => item.name || item.field).filter(Boolean).join('、');
    return safe.length > 4 ? `${picked}等${safe.length}项` : picked;
}

function compactChangedItems(items = []) {
    const safe = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!safe.length) return '';
    return safe.slice(0, 2).map(item => {
        const label = item.label || item.key || '未命名指标';
        const fieldText = compactChangedFieldList(item.changedFields);
        return `“${label}”${fieldText ? `的${fieldText}` : ''}`;
    }).join('、') + (safe.length > 2 ? `等${safe.length}项` : '');
}

function compactKeyList(keys = []) {
    const safe = Array.isArray(keys) ? keys.filter(Boolean).map(String) : [];
    if (!safe.length) return '';
    const picked = safe.slice(0, 3).join('、');
    return safe.length > 3 ? `${picked}等${safe.length}项` : picked;
}

function describePrefKey(key) {
    const names = {
        expediteIgnoreKeywords: '延期忽略关键字',
        expediteTemplate: '延期通知模板',
        manualAdjustItems: '手动加减分项目',
        manualAdjustAutoFill: '手动加减分自动填充',
        isAutoStandardTotalScore: '标准总分自动计算',
        i18nMap: '字段显示名称'
    };
    if (names[key]) return names[key];
    if (String(key || '').startsWith('sla_prefs_')) return `单表偏好 ${key}`;
    return key || '偏好配置';
}

function compactValue(value) {
    if (Array.isArray(value)) {
        const primitiveItems = value.filter(item => item === null || ['string', 'number', 'boolean'].includes(typeof item));
        if (primitiveItems.length === value.length) {
            const picked = primitiveItems.slice(0, 3).map(item => JSON.stringify(item)).join('、');
            return value.length > 3 ? `[${picked}等${value.length}项]` : `[${picked}]`;
        }
        return `数组${value.length}项`;
    }
    if (value && typeof value === 'object') return `对象${Object.keys(value).length}项`;
    return JSON.stringify(value);
}

function describePrefField(field) {
    const names = {
        visibleHeaders: '显示列',
        columnWidths: '列宽',
        sortKey: '排序字段',
        sortAsc: '排序方向',
        customMetrics: '指标规则',
        _sourceMeta: '来源信息'
    };
    return names[field] || field;
}

function compactChangedPrefFields(item = {}) {
    const before = item.before && typeof item.before === 'object' && !Array.isArray(item.before) ? item.before : {};
    const after = item.after && typeof item.after === 'object' && !Array.isArray(item.after) ? item.after : {};
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
    const changed = keys.filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
    if (!changed.length) return '';
    const picked = changed.slice(0, 4).map(describePrefField).join('、');
    return changed.length > 4 ? `${picked}等${changed.length}项` : picked;
}

function compactChangedPrefs(items = []) {
    const safe = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!safe.length) return '';
    return safe.slice(0, 2).map(item => {
        const name = describePrefKey(item.key);
        if (String(item.key || '').startsWith('sla_prefs_')) {
            const fields = compactChangedPrefFields(item);
            return `${name}${fields ? `的${fields}` : '内容'}已变化`;
        }
        return `${name}从${compactValue(item.before)}改为${compactValue(item.after)}`;
    }).join('、') + (safe.length > 2 ? `等${safe.length}项` : '');
}

function buildFallbackSummary(event) {
    const detail = event.detail && typeof event.detail === 'object' ? event.detail : {};
    const request = detail.request || {};
    const diff = detail.diff || {};
    const actor = request.actor || event.actor || '系统';
    const method = request.method || '';
    const page = describePageFromRequest(request);
    const beforeCount = diff.before && Number.isFinite(Number(diff.before.metricRuleCount))
        ? Number(diff.before.metricRuleCount)
        : null;
    const afterCount = diff.after && Number.isFinite(Number(diff.after.metricRuleCount))
        ? Number(diff.after.metricRuleCount)
        : null;
    const added = compactLabelList(diff.addedLabels);
    const removed = compactLabelList(diff.removedLabels);
    const changedItems = compactChangedItems(detail.changedItems);
    const removedItems = compactLabelList((detail.removedItems || []).map(item => item && item.label));
    const changedKeys = compactKeyList(detail.changedKeys);
    const removedKeys = compactKeyList(detail.removedKeys);
    const changedPrefs = compactChangedPrefs(detail.changedPrefs);

    if (changedItems) {
        return `${actor}在${page}${method ? `通过${method}` : ''}调整${changedItems}。`;
    }

    if (beforeCount !== null && afterCount !== null && beforeCount !== afterCount) {
        const action = afterCount > beforeCount ? '新增' : '移除';
        const labelText = added || removed;
        return `${actor}在${page}${method ? `通过${method}` : ''}${action}规则${beforeCount}→${afterCount}${labelText ? `，涉及${labelText}` : ''}。`;
    }

    if (removedItems) {
        return `${actor}在${page}${method ? `通过${method}` : ''}删除${removedItems}。`;
    }

    if (detail.before && detail.after && detail.after.label) {
        return `${actor}在${page}${method ? `通过${method}` : ''}调整“${detail.after.label}”目标或权重。`;
    }

    if (changedPrefs) {
        return `${actor}在${page}${method ? `通过${method}` : ''}调整${changedPrefs}。`;
    }

    if (diff.before && diff.after && Number.isFinite(Number(diff.before.keyCount)) && Number.isFinite(Number(diff.after.keyCount))) {
        return `${actor}在${page}${method ? `通过${method}` : ''}${event.title || '修改配置'}。`;
    }

    if (changedKeys || removedKeys) {
        const parts = [];
        if (changedKeys) parts.push(`变更${changedKeys}`);
        if (removedKeys) parts.push(`删除${removedKeys}`);
        return `${actor}在${page}${method ? `通过${method}` : ''}${parts.join('，')}。`;
    }

    if (diff.before && diff.after && diff.before.hash !== diff.after.hash) {
        return `${actor}在${page}${method ? `通过${method}` : ''}修改配置内容，数量未变但内容hash已变化。`;
    }

    if (event.title || event.message) {
        return `${actor}触发${event.title || event.message}。`;
    }

    return '系统记录了一条待关注告警。';
}

function isWeakAiSummary(summary, fallback) {
    const text = cleanAiText(summary);
    if (!text) return true;
    if (text.length < 12 && fallback.length >= 12) return true;
    if (/[`{}[\]]/.test(text)) return true;
    if (/^(admin|管理员|system|系统)$/i.test(text)) return true;
    if (/https?:?$/i.test(text) || /通过https?$/i.test(text)) return true;
    if (/^(admin|管理员|system|系统).{0,8}(通过|来源|来自)$/i.test(text)) return true;
    return false;
}

async function updateAlertAi(id, summary, status = 'done') {
    await alertCenterRepo.ensureReady();
    await run(
        `UPDATE alert_center_events
         SET ai_summary = ?, ai_status = ?, ai_analyzed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [String(summary || '').slice(0, 500), status, id]
    );
}

async function analyzeOne(event) {
    const fallbackSummary = cleanAiText(buildFallbackSummary(event));
    const settings = await aiSettingsRepo.getRuntimeSettings();
    if (!settings.hasApiKey || !settings.keyLooksValid) {
        await updateAlertAi(event.id, fallbackSummary, 'fallback_no_ai');
        return 'done';
    }

    // 熔断保护：若外网 AI 连续失败，直接使用高质量参考摘要，不卡顿、不耗时
    if (alertAiCircuit.isOpen()) {
        await updateAlertAi(event.id, fallbackSummary, 'fallback_circuit');
        return 'done';
    }

    const now = Date.now();
    if (!canUseAi(now)) {
        return 'rate_limited';
    }
    markAiUsed(now);

    const client = aiProviderClient.createClient(settings);
    const prompt = `你是 Tools Platform 告警台的值班分析助手。请基于告警负载，用中文输出一句话总结，最多 55 个汉字。

要求：
- 直接说风险/变化/来源，不要寒暄。
- 结合 diff、request、账号/IP、数量变化等关键信息。
- 不要泄露 token、密码、完整长 payload。
- 只输出一句完整的话，不要项目符号。
- 如果你无法写得比参考摘要更清楚，就直接输出参考摘要。

参考摘要：${fallbackSummary}

告警：
标题：${event.title || ''}
类型：${event.event_type || ''}
级别：${event.severity || ''}
描述：${event.message || ''}
操作人：${event.actor || ''}
来源：${event.source || ''}
对象：${event.object_type || ''} ${event.object_id || ''}
详情JSON：
${compactJson(event.detail)}
`;
    const result = await client.generateText({
        prompt,
        maxOutputTokens: 96,
        temperature: 0.25,
        signal: alertAiCircuit.createTimeoutSignal(3500)
    });
    alertAiCircuit.recordSuccess();
    const summary = cleanAiText(result.text);
    const finalSummary = isWeakAiSummary(summary, fallbackSummary) ? fallbackSummary : summary;
    await updateAlertAi(event.id, finalSummary, finalSummary === fallbackSummary ? 'fallback_done' : 'done');
    return 'done';
}

async function processQueue() {
    if (processing) return;
    processing = true;
    try {
        while (queue.length) {
            const event = queue.shift();
            try {
                const result = await analyzeOne(event);
                if (result === 'rate_limited') {
                    queue.unshift(event);
                    setTimeout(processQueue, getRateLimitDelay());
                    return;
                }
            } catch (err) {
                alertAiCircuit.recordFailure(err);
                console.warn('[alert-ai] analyze failed, using fallback summary:', err.message || err);
                const fallback = cleanAiText(buildFallbackSummary(event));
                await updateAlertAi(event.id, fallback, 'fallback_failed').catch(() => {});
            }
            await new Promise(resolve => setTimeout(resolve, 1200));
        }
    } finally {
        processing = false;
    }
}

function enqueueAlertAnalysis(event) {
    if (!event || !event.id) return;
    if (queue.some(item => item.id === event.id)) return;
    if (queue.length >= MAX_QUEUE_SIZE) {
        updateAlertAi(event.id, '', 'skipped_queue_full').catch(() => {});
        return;
    }
    queue.push(event);
    setTimeout(processQueue, 100);
}

async function enqueuePendingAlertAnalyses({ limit = 80, force = false } = {}) {
    await alertCenterRepo.ensureReady();
    const safeLimit = Math.max(1, Math.min(Number(limit) || 80, 200));
    const statusFilter = force
        ? ''
        : "AND (ai_status IS NULL OR ai_status IN ('pending', '', 'failed', 'skipped_rate_limited'))";
    const rows = await all(
        `SELECT id, event_type, severity, title, message, actor, source, object_type, object_id,
                detail_json AS detailJson
         FROM alert_center_events
         WHERE status != 'archived'
           ${statusFilter}
         ORDER BY datetime(created_at) DESC, rowid DESC
         LIMIT ?`,
        [safeLimit]
    );
    rows.forEach(row => {
        let detail = {};
        try { detail = JSON.parse(row.detailJson || '{}'); } catch (_err) {}
        enqueueAlertAnalysis({
            id: row.id,
            event_type: row.event_type,
            severity: row.severity,
            title: row.title,
            message: row.message,
            actor: row.actor,
            source: row.source,
            object_type: row.object_type,
            object_id: row.object_id,
            detail
        });
    });
    return { queued: rows.length };
}

function startAlertAiBackfill() {
    if (startupScheduled) return;
    startupScheduled = true;
    setTimeout(() => {
        enqueuePendingAlertAnalyses({ limit: 120 }).catch(err => {
            console.warn('[alert-ai] startup backfill failed:', err.message || err);
        });
    }, 5000);
}

module.exports = {
    enqueueAlertAnalysis,
    enqueuePendingAlertAnalyses,
    startAlertAiBackfill
};
