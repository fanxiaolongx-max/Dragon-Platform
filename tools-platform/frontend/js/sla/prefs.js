/**
 * sla/prefs.js - 表格偏好存储模块（列宽/显示列/排序/自定义指标规则）
 * 与服务端 /api/sla/prefs/:schemaHash 交互，替代原 localStorage
 */

async function loadPrefs(secId) {
    const state = AppState[secId];
    try {
        const mode = API.getSourceMode('sla_data');
        const query = mode === 'auto' ? '' : `?mode=${encodeURIComponent(mode)}`;
        const path = `/api/sla/prefs/${encodeURIComponent(state.schemaHash)}${query}`;
        const saved = await API.get(path);
        state.hasSavedPrefs = !!saved;
        window.__lastSLAPrefsPath = path;
        if (saved) {
            const hasVisibleHeaders = Object.prototype.hasOwnProperty.call(saved, 'visibleHeaders')
                && Array.isArray(saved.visibleHeaders);
            const validV = (saved.visibleHeaders || []).filter(h => state.orderedHeaders.includes(h));
            state.visibleHeaders = hasVisibleHeaders ? validV : [...state.orderedHeaders];
            state.columnWidths = saved.columnWidths || {};
            state.sortKey = saved.sortKey || null;
            state.sortAsc = saved.sortAsc !== undefined ? saved.sortAsc : true;
            state.customMetrics = saved.customMetrics || [];
            state.sourceMeta = saved._sourceMeta || null;
        }
        if (window.renderSLASourcePanel) window.renderSLASourcePanel();
    } catch (e) {
        // 服务端无数据时使用默认值（不报错）
        if (window.renderSLASourcePanel) window.renderSLASourcePanel();
    }
}

function normalizeSourcePrefix(name) {
    const baseName = String(name || '').trim().replace(/\.[^.]+$/, '');
    if (!baseName) return '';
    const latestIndex = baseName.indexOf('_Latest');
    if (latestIndex >= 0) return `${baseName.slice(0, latestIndex + '_Latest'.length)}*`;
    return baseName;
}

function buildSourceMeta(secId) {
    const state = AppState[secId];
    const sourceFiles = Array.from(new Set((state.sourceFiles || []).filter(Boolean).map(String)));
    const prefixes = Array.from(new Set(sourceFiles.map(normalizeSourcePrefix).filter(Boolean)));
    const matchedPrefix = prefixes.length ? prefixes.join(' / ') : (state.mode === 'other' ? (state.title || secId) : '');
    return {
        secId,
        mode: state.mode || '',
        title: state.title || '',
        schemaHash: state.schemaHash || '',
        baseName: state.baseName || '',
        sourceFiles,
        matchedPrefix,
        updatedAt: new Date().toISOString()
    };
}

function buildPrefsPayload(secId) {
    const state = AppState[secId];
    return {
        visibleHeaders: state.visibleHeaders,
        columnWidths: state.columnWidths,
        sortKey: state.sortKey,
        sortAsc: state.sortAsc,
        customMetrics: state.customMetrics,
        _sourceMeta: buildSourceMeta(secId)
    };
}

async function savePrefs(secId) {
    const state = AppState[secId];
    const metricSignature=window.SLAMetricSnapshotSync?.fingerprint();
    try {
        await API.put(`/api/sla/prefs/${encodeURIComponent(state.schemaHash)}`, buildPrefsPayload(secId));
        if(metricSignature===window.SLAMetricSnapshotSync?.fingerprint())window.SLAMetricSnapshotSync?.schedule();
    } catch (e) {
        window.SLAMetricSnapshotSync?.rulesFailed();
        // Display-only preference failures do not interrupt the main workflow.
    }
}

async function saveSourceMeta(secId) {
    const state = AppState[secId];
    if (!state) return;
    if (!Array.isArray(state.customMetrics) || state.customMetrics.length === 0) {
        return;
    }
    await savePrefs(secId);
}

window.SLAPrefs = { loadPrefs, savePrefs, saveSourceMeta };
