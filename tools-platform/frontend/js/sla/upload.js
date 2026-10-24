/**
 * sla/upload.js - 文件上传与解析引擎
 * 完整移植原版：XLSX 解析、智能分流（整改/常规/专项/其他）、版本标识注入
 */

const RECT_PRIORITY_COLS    = ['task_id', 'task_owner', 'fullname', 'product_line_name', 'network_name', 'task_status', 'task_create_time', 'rectify_plan_end_time'];
const RISK_PRIORITY_COLS    = ['task_id', 'network', 'product_level_l1', 'product', 'current_handler', 'current_handler_name', '风险状态', 'risk_status', '创单时间', 'create_time', '期望关闭时间', 'ticket_close_due_date', '期望关闭时间-挂起'];
const SPECIAL_PRIORITY_COLS = ['task_id', 'network_name', 'owner_show', '状态-Status', 'task_status_en', 'task_status', 'task_status_cn', '创建日期-Create Date', 'create_time', '要求完成日期-Required Completion Date', 'required_completion_time', 'plan_complete_date'];
const SR_PRIORITY_COLS      = ['sr_num', 't1_operator', 'product_line_map', 'product', 'sr_owner', 'hw_sev_name', 'urgency', 'sr_status_name', 'open_date', 'exp_close_date', 'sus_exp_close_date', 'act_close_date', 'overdue', 'sr_id', 'customer_name', 'country_name_cn', 'repoffice_name_cn'];
const VULN_PRIORITY_COLS    = ['task_id', 'task_status', 'network_customer_name', 'task_owner_name', 'create_time', 'task_create_time', 'vuln_id', 'vulnerability_id', '漏洞编号', '漏洞名称', 'vulnerability_name', 'customer_name', 'network_name'];
const SLA_MONITORING_SECTION_ORDER = ['rectification', 'special', 'risk', 'sr', 'vulnerability'];
const SLA_MONITORING_FILE_PATTERNS = [
    ['rectification', /^PBI_自动抓取-整改详单_整改(?:[-_][a-z0-9]+)*_Latest/i],
    ['special', /^PBI_自动抓取-CPT风险详表(?:[-_][a-z0-9]+)*_Latest/i],
    ['risk', /^PBI_自动抓取-风险详单(?:[-_][a-z0-9]+)*_Latest/i],
    ['sr', /^PBI_自动抓取-详单-SR(?:[-_][a-z0-9]+)*_Latest/i],
    ['vulnerability', /^PBI_自动抓取-详单漏洞_漏洞预警(?:[-_][a-z0-9]+)*_Latest/i]
];
const SLA_WORKSPACE_CACHE_KEY = 'sla_last_import_workspace_v1';
const SLA_WORKSPACE_CACHE_STATUS_KEY = 'sla_last_import_workspace_status_v1';
const SLA_RUNTIME_FIELDS = new Set([
    '_slaDeadline', '_slaRuleMatched', '_slaDays', '_slaText', '_slaCleanText', '_rowClass',
    '_alertSeverity', '_rawStringForSearch', '_srDisposition', '_srStatus',
    '_srSeverity', '_srConsumeRate', '_srRemainingHours', '_srRemainingDays'
]);

function isRuntimeField(name) {
    return SLA_RUNTIME_FIELDS.has(String(name || ''));
}

function sanitizeWorkspaceRow(row) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    return Object.fromEntries(Object.entries(row).filter(([name]) => !isRuntimeField(name)));
}

function sanitizeWorkspaceRows(rows) {
    return (Array.isArray(rows) ? rows : []).map(sanitizeWorkspaceRow);
}

function ensureLazyWorkspaceStyles() {
    if (document.getElementById('sla-lazy-workspace-style')) return;
    const style = document.createElement('style');
    style.id = 'sla-lazy-workspace-style';
    style.textContent = `
        .sla-section-tabs-shell { margin: 14px 0 16px; padding: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; }
        .sla-section-tabs-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; }
        .sla-section-tabs-title { margin:0; color:#166534; font-size:16px; font-weight:800; }
        .sla-section-tabs-hint { color:#64748b; font-size:12px; white-space:nowrap; }
        .sla-section-tabs { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
        .sla-section-tab { border:1px solid var(--tab-color, #64748b); color:var(--tab-color, #334155); background:#fff; border-radius:999px; padding:7px 11px; cursor:pointer; font-size:12px; font-weight:800; box-shadow:0 1px 2px rgba(15,23,42,.06); transition:background .16s ease, color .16s ease, transform .16s ease; }
        .sla-section-tab:hover { transform:translateY(-1px); background:#f1f5f9; }
        .sla-section-tab.active { background:var(--tab-color, #334155); color:#fff; box-shadow:0 6px 14px rgba(15,23,42,.16); }
        .sla-section-tab .tab-count { opacity:.78; font-weight:700; margin-left:4px; }
        .sla-lazy-table-placeholder { margin: 14px; padding: 24px; text-align:center; color:#64748b; background:#f8fafc; border:1px dashed #cbd5e1; border-radius:10px; font-size:13px; }
        .sla-cache-notice { margin: 14px 0 16px; padding: 14px 16px; border-radius: 10px; border: 1px solid #f8c471; background: linear-gradient(135deg, #fff8e7, #fffdf7); color: #7a4b00; box-shadow: 0 3px 12px rgba(146, 64, 14, 0.06); }
        .sla-cache-notice-title { font-size: 15px; font-weight: 900; margin-bottom: 6px; color: #92400e; }
        .sla-cache-notice-body { font-size: 13px; line-height: 1.6; color: #7c5a1d; }
        .sla-cache-notice-actions { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 8px; }
        .sla-cache-notice-actions button { border: 1px solid #f3c36b; background: #fff; color: #92400e; border-radius: 7px; padding: 6px 10px; font-size: 12px; font-weight: 800; cursor: pointer; }
        .sla-cache-notice-actions button:hover { background: #fff7df; }
        @media (max-width: 760px) {
            .sla-section-tabs-head { align-items:flex-start; flex-direction:column; }
            .sla-section-tabs-hint { white-space:normal; }
            .sla-section-tab { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        }
    `;
    document.head.appendChild(style);
}

function buildSectionTabs(sections, summaryTitle) {
    if (!Array.isArray(sections) || !sections.length) return '';
    ensureLazyWorkspaceStyles();
    const title = escapeHTML(summaryTitle || SLAT('sla.upload.cachedTitle'));
    const hint = sections.length > 1
        ? `默认仅加载第 1 个表格明细，其余 ${sections.length - 1} 个点击标签后加载，减少页面卡顿。`
        : '当前仅 1 个表格。';
    const buttons = sections.map((section, index) => {
        const count = Array.isArray(section.data) ? section.data.length : 0;
        const color = section.themeColor || '#555';
        return `<button type="button" class="sla-section-tab ${index === 0 ? 'active' : ''}" data-sec-id="${escapeHTML(section.secId)}" onclick="SLAUpload.activateSectionTab('${escapeHTML(section.secId)}')" style="--tab-color:${escapeHTML(color)}" title="${escapeHTML(section.title)}">${escapeHTML(section.title)}<span class="tab-count">${count}行</span></button>`;
    }).join('');
    return `<div class="sla-section-tabs-shell">
        <div class="sla-section-tabs-head">
            <h3 class="sla-section-tabs-title">${title}</h3>
            <span class="sla-section-tabs-hint">${escapeHTML(hint)}</span>
        </div>
        <div class="sla-section-tabs">${buttons}</div>
    </div>`;
}

function buildCachedSectionNav(sections, summaryTitle) {
    return buildSectionTabs(sections || [], summaryTitle);
}

function persistWorkspaceCache(sections, meta = {}) {
    if (!Array.isArray(sections) || !sections.length) return;
    const rows = sections.reduce((sum, section) => sum + (Array.isArray(section.data) ? section.data.length : 0), 0);
    const payload = {
        version: 1,
        savedAt: new Date().toISOString(),
        meta,
        sections: sections.map(section => ({
            secId: section.secId,
            mode: section.mode,
            title: section.title,
            themeColor: section.themeColor,
            baseName: section.baseName || '',
            sourceFiles: Array.isArray(section.sourceFiles) ? section.sourceFiles : [],
            originalSchemaHash: section.originalSchemaHash || '',
            savedRules: section.savedRules || [],
            archiveSupplementary: !!section.archiveSupplementary,
            data: sanitizeWorkspaceRows(section.data)
        }))
    };
    try {
        localStorage.setItem(SLA_WORKSPACE_CACHE_KEY, JSON.stringify(payload));
        localStorage.removeItem(SLA_WORKSPACE_CACHE_STATUS_KEY);
        logSLAUploadStep('已缓存本次导入工作区', {
            sections: payload.sections.length,
            rows
        });
    } catch (err) {
        logSLAUploadError('缓存导入工作区', err, { rows });
        try {
            localStorage.removeItem(SLA_WORKSPACE_CACHE_KEY);
            localStorage.setItem(SLA_WORKSPACE_CACHE_STATUS_KEY, JSON.stringify({
                version: 1,
                status: 'too_large',
                savedAt: new Date().toISOString(),
                rows,
                sections: payload.sections.length,
                files: Array.isArray(meta.files) ? meta.files : [],
                errorName: err && err.name ? err.name : '',
                message: err && err.message ? err.message : ''
            }));
        } catch (statusErr) {
            logSLAUploadError('记录导入工作区缓存状态', statusErr);
        }
        renderWorkspaceCacheNotice({
            status: 'too_large',
            rows,
            sections: payload.sections.length,
            files: Array.isArray(meta.files) ? meta.files : []
        }, { preserveWorkspace: true });
        if (typeof showToast === 'function') showToast(SLAT('sla.upload.cacheLarge'), 'warning');
    }
}

function readWorkspaceCacheStatus() {
    try {
        return JSON.parse(localStorage.getItem(SLA_WORKSPACE_CACHE_STATUS_KEY) || 'null');
    } catch (err) {
        localStorage.removeItem(SLA_WORKSPACE_CACHE_STATUS_KEY);
        return null;
    }
}

function clearWorkspaceCacheStatus() {
    try {
        localStorage.removeItem(SLA_WORKSPACE_CACHE_STATUS_KEY);
    } catch (err) {
        logSLAUploadError('清空导入工作区缓存状态', err);
    }
}

function renderWorkspaceCacheNotice(status, options = {}) {
    const noticeStatus = status || readWorkspaceCacheStatus();
    if (!noticeStatus || noticeStatus.status !== 'too_large') return false;
    ensureLazyWorkspaceStyles();

    const rowsText = noticeStatus.rows ? `${noticeStatus.rows}` : '-';
    const fileCount = Array.isArray(noticeStatus.files) ? noticeStatus.files.length : 0;
    const savedAt = noticeStatus.savedAt ? new Date(noticeStatus.savedAt).toLocaleString() : '';
    const detailParts = [
        SLAT('sla.upload.cacheTooLargeRows', { rows: rowsText }),
        fileCount ? SLAT('sla.upload.cacheTooLargeFiles', { count: fileCount }) : '',
        savedAt ? SLAT('sla.upload.cacheTooLargeTime', { time: savedAt }) : ''
    ].filter(Boolean);

    const html = `<div class="sla-cache-notice" id="sla-cache-notice">
        <div class="sla-cache-notice-title">${SLAT('sla.upload.cacheTooLargeTitle')}</div>
        <div class="sla-cache-notice-body">
            ${SLAT('sla.upload.cacheTooLargeBody')}
            <div style="margin-top:6px;">${detailParts.map(escapeHTML).join(' · ')}</div>
        </div>
        <div class="sla-cache-notice-actions">
            <button type="button" onclick="SLAUpload.dismissWorkspaceCacheNotice()">${SLAT('sla.upload.cacheTooLargeDismiss')}</button>
            <button type="button" onclick="document.getElementById('batch-upload')?.click()">${SLAT('sla.upload.cacheTooLargeClear')}</button>
        </div>
    </div>`;

    const summaryNav = document.getElementById('summary-nav-area');
    const mainWrapper = document.getElementById('main-wrapper');
    if (mainWrapper && options.preserveWorkspace) {
        const existing = document.getElementById('sla-cache-notice');
        if (existing) existing.remove();
        mainWrapper.insertAdjacentHTML('afterbegin', html);
        return true;
    }
    if (summaryNav) {
        summaryNav.innerHTML = html;
        summaryNav.style.display = 'block';
        return true;
    }
    if (mainWrapper && !options.preserveWorkspace) {
        mainWrapper.innerHTML = html;
        return true;
    }
    return false;
}

function dismissWorkspaceCacheNotice() {
    clearWorkspaceCacheStatus();
    const notice = document.getElementById('sla-cache-notice');
    if (notice) notice.remove();
    const summaryNav = document.getElementById('summary-nav-area');
    if (summaryNav && !summaryNav.innerHTML.trim()) summaryNav.style.display = 'none';
}

function resetRuntimeWorkspace() {
    window.SLAMetricSnapshotSync?.reset();
    if (window.AppState) {
        Object.keys(window.AppState).forEach(key => { delete window.AppState[key]; });
    }
    window.GlobalMetrics = {};
}

function renderEmptyWorkspace() {
    setGlobalRuleBoxCollapsed(false);
    const summaryNav = document.getElementById('summary-nav-area');
    const mainWrapper = document.getElementById('main-wrapper');
    if (summaryNav) {
        summaryNav.innerHTML = '';
        summaryNav.style.display = 'none';
    }
    if (mainWrapper) {
        mainWrapper.innerHTML = `<div class="sla-empty-workspace">${SLAT('sla.empty.main')}</div>`;
    }
    const archiveStatus = document.getElementById('sourceArchiveStatus');
    if (archiveStatus) archiveStatus.textContent = '';
    if (typeof window.updateUploadStatusVisibility === 'function') window.updateUploadStatusVisibility();
    document.querySelectorAll('.upload-actions input[type="file"]').forEach(input => { input.value = ''; });
    if (window.SLAMetrics && typeof window.SLAMetrics.renderTopStickyBar === 'function') {
        window.SLAMetrics.renderTopStickyBar();
    }
}

function setGlobalRuleBoxCollapsed(collapsed) {
    const ruleBox = document.querySelector('.rule-box');
    if (!ruleBox) return;
    ruleBox.hidden = Boolean(collapsed);
}

function activateSectionTab(secId) {
    const sectionId = String(secId || '');
    if (!sectionId) return;
    document.querySelectorAll('#main-wrapper .section-card').forEach(section => {
        section.style.display = section.id === `section-${sectionId}` ? '' : 'none';
    });
    document.querySelectorAll('.sla-section-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.secId === sectionId);
    });
    const state = window.AppState && window.AppState[sectionId];
    if (state && state.tableRenderSuspended) {
        state.tableRenderSuspended = false;
        const container = document.getElementById(`table-container-${sectionId}`);
        if (container) delete container.dataset.lazyPlaceholder;
        if (typeof updateView === 'function') updateView(sectionId);
    }
    const section = document.getElementById(`section-${sectionId}`);
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function sortArchiveReviewSections(sections) {
    const rank = section => {
        if (section.archiveSupplementary) return SLA_MONITORING_SECTION_ORDER.length + 1;
        const monitoringIndex = SLA_MONITORING_SECTION_ORDER.indexOf(section.mode);
        return monitoringIndex >= 0 ? monitoringIndex : SLA_MONITORING_SECTION_ORDER.length;
    };
    return sections.sort((a, b) => rank(a) - rank(b));
}

function activateInitialSection(sections) {
    const first = Array.isArray(sections) && sections.length ? sections[0] : null;
    if (first && first.secId) activateSectionTab(first.secId);
}

async function clearWorkspaceCache({ skipConfirm = false } = {}) {
    if (!skipConfirm && !await AppDialog.confirm(SLAT('sla.upload.confirmClearCache'), { title: SLAT('sla.dialog.confirm'), tone: 'danger', cancelText: SLAT('sla.dialog.cancel') })) return false;
    try {
        localStorage.removeItem(SLA_WORKSPACE_CACHE_KEY);
        localStorage.removeItem(SLA_WORKSPACE_CACHE_STATUS_KEY);
    } catch (err) {
        logSLAUploadError('清空导入工作区缓存', err);
        if (typeof showToast === 'function') showToast(SLAT('sla.upload.clearCacheFail'), 'error');
        return false;
    }
    resetRuntimeWorkspace();
    renderEmptyWorkspace();
    logSLAUploadStep('已清空当前导入工作区缓存');
    if (typeof showToast === 'function') showToast(SLAT('sla.upload.clearCacheSuccess'));
    return true;
}

let workspaceRestorePromise = null;
let archiveReviewRequested = false;
function restoreCachedWorkspace() {
    if (archiveReviewRequested && !workspaceRestorePromise) return Promise.resolve(false);
    if (!workspaceRestorePromise) {
        workspaceRestorePromise = restoreCachedWorkspaceInternal().finally(() => { workspaceRestorePromise = null; });
    }
    return workspaceRestorePromise;
}
async function restoreCachedWorkspaceInternal() {
    if (window.AppState && Object.keys(window.AppState).length > 0) return false;
    let payload = null;
    try {
        payload = JSON.parse(localStorage.getItem(SLA_WORKSPACE_CACHE_KEY) || 'null');
    } catch (err) {
        localStorage.removeItem(SLA_WORKSPACE_CACHE_KEY);
        return false;
    }
    const sections = payload && Array.isArray(payload.sections)
        ? payload.sections
            .filter(s => s && s.secId && Array.isArray(s.data) && s.data.length)
            .map(section => ({ ...section, data: sanitizeWorkspaceRows(section.data) }))
        : [];
    if (payload?.meta?.type === 'archive-review') sortArchiveReviewSections(sections);
    if (!sections.length || !window.SLASection || typeof window.SLASection.initSection !== 'function') {
        return renderWorkspaceCacheNotice(readWorkspaceCacheStatus());
    }
    if (payload.meta?.type === 'archive-review' && payload.meta.reviewMonitoringVersion !== 1 && payload.meta.sourceSnapshotId) {
        try {
            const snapshot = await API.get('/api/upload/source-snapshots/' + encodeURIComponent(payload.meta.sourceSnapshotId));
            await loadArchivedSnapshot(snapshot, { fromCacheRestore: true });
            return true;
        } catch (error) { logSLAUploadError('恢复历史导入监控', error); }
    }

    if (payload.meta?.type === 'archive-review' && payload.meta.archiveNamesVersion !== 1) {
        try {
            const catalog = await API.get('/api/upload/source-catalog');
            const originals = new Map();
            for (const file of catalog.files || []) for (const sheet of file.sheets || []) {
                originals.set('other_archive_' + generateSchemaHash(file.id + '@@' + sheet.name), { file, sheet });
            }
            for (const section of sections) {
                const original = originals.get(section.secId);
                if (!original) continue;
                section.title = original.file.name + ' / ' + original.sheet.name;
                section.baseName = section.title;
                section.sourceFiles = [original.file.name];
            }
            payload.sections = sections;
            payload.meta.files = [...new Set(sections.flatMap(section => section.sourceFiles || []))];
            payload.meta.archiveNamesVersion = sections.every(section => originals.has(section.secId)) ? 1 : undefined;
            localStorage.setItem(SLA_WORKSPACE_CACHE_KEY, JSON.stringify(payload));
        } catch (error) {
            // Keep the cached rows available offline; retry name repair on the next reload.
            logSLAUploadError('修复历史回顾缓存文件名', error);
        }
    }

    const mainWrapper = document.getElementById('main-wrapper');
    const summaryNav = document.getElementById('summary-nav-area');
    if (mainWrapper) mainWrapper.innerHTML = `<div class="loading-text">${SLAT('sla.upload.restoreLoading')}</div>`;
    if (summaryNav) summaryNav.style.display = 'none';

    try {
        if (mainWrapper) mainWrapper.innerHTML = '';
        if (payload.meta?.selectedTargetMonth) window.SLATargetMonth?.set?.(payload.meta.selectedTargetMonth);
        const initPromises = sections.map((section, index) =>
            window.SLASection.initSection(section.secId, section.mode, section.title, section.data, section.themeColor || '#555', section.baseName || '', section.sourceFiles || [], { deferTableRender: index > 0, reviewOnly: payload.meta?.type === 'archive-review', originalSchemaHash:section.originalSchemaHash, savedRules:section.savedRules, archiveSupplementary:section.archiveSupplementary })
        );
        if (summaryNav) {
            const navHtml = buildCachedSectionNav(sections, payload.meta && payload.meta.summaryTitle);
            summaryNav.innerHTML = navHtml;
            summaryNav.style.display = navHtml ? 'block' : 'none';
        }
        await Promise.all(initPromises);
        activateInitialSection(sections);
        if (payload.meta?.type === 'archive-review') renderArchiveReviewNotice(payload.meta);
        setGlobalRuleBoxCollapsed(true);
        logSLAUploadStep('已恢复上次导入工作区', {
            savedAt: payload.savedAt,
            sections: sections.length,
            rows: sections.reduce((sum, section) => sum + section.data.length, 0)
        });
        window.SLAMetricSnapshotSync?.bind(payload.meta?.metricSnapshotContext);
        window.SLAMetricSnapshotSync?.schedule();
        if (typeof showToast === 'function') showToast(SLAT('sla.upload.restoreSuccess'));
        return true;
    } catch (err) {
        logSLAUploadError('恢复上次导入工作区', err);
        if (mainWrapper) {
            mainWrapper.innerHTML = `<div class="sla-cache-notice">
                <div class="sla-cache-notice-title">${SLAT('sla.upload.restoreFailTitle')}</div>
                <div class="sla-cache-notice-body">${SLAT('sla.upload.restoreFail')}</div>
            </div>`;
        }
        return false;
    }
}

function generateSchemaHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash = hash & hash; }
    return Math.abs(hash).toString(36);
}

function getJSONBytes(value) {
    try {
        return new Blob([JSON.stringify(value)]).size;
    } catch (e) {
        return 0;
    }
}

function isSLACompressionSupported() {
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
    const snapshotText = JSON.stringify(snapshot);
    const compressedSnapshot = await compressTextToTransportField(snapshotText, algorithm);
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

function logSLAUploadStep(step, detail) {
    const prefix = '%c[SLA Upload]';
    const style = 'color:#0ea5e9;font-weight:700;';
    if (detail === undefined) {
        console.info(prefix, style, step);
        return;
    }
    console.info(prefix, style, step, detail);
}

function logSLAUploadError(step, error, detail) {
    const prefix = '%c[SLA Upload]';
    const style = 'color:#ef4444;font-weight:700;';
    console.error(prefix, style, `${step} failed`, detail || '', error);
}

async function readFiles(files) {
    const promises = files.map(file => new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { raw: false });
                let suffix = '';
                const latestIdx = file.name.lastIndexOf('Latest');
                if (latestIdx !== -1) {
                    suffix = file.name.substring(latestIdx + 6).replace(/\.[^/.]+$/, '').trim();
                } else {
                    suffix = file.name.replace(/\.[^/.]+$/, '').trim();
                }
                jsonData.forEach(row => { row['版本标识'] = suffix ? suffix : '主版本(Base)'; });
                resolve(jsonData);
            } catch (err) { resolve([]); }
        };
        reader.readAsArrayBuffer(file);
    }));
    const results = await Promise.all(promises);
    return results.reduce((a, b) => a.concat(b), []);
}

function getVersionSuffixFromName(name) {
    const fileName = String(name || '');
    const latestIdx = fileName.lastIndexOf('Latest');
    if (latestIdx !== -1) {
        return fileName.substring(latestIdx + 6).replace(/\.[^/.]+$/, '').trim();
    }
    return fileName.replace(/\.[^/.]+$/, '').trim();
}

function getSourceName(source) {
    return String(source && source.name || '').trim();
}

function getMonitoringModeFromName(name) {
    // Script renaming also changes download names, e.g. 风险详单-CN_Latest.csv.
    return SLA_MONITORING_FILE_PATTERNS.find(([, pattern]) => pattern.test(String(name || '').trim()))?.[0] || 'other';
}

function getSourceNames(sources) {
    return Array.from(new Set((sources || []).map(getSourceName).filter(Boolean)));
}

function getSelectedImportMonth() {
    const month = window.SLATargetMonth && typeof window.SLATargetMonth.get === 'function'
        ? Number(window.SLATargetMonth.get())
        : (new Date().getMonth() + 1);
    return Number.isFinite(month) && month >= 1 && month <= 12 ? month : (new Date().getMonth() + 1);
}

function extractLatestFileMonth(name) {
    const match = String(name || '').match(/Latest[_\s-]*(?:20\d{2})年(0?[1-9]|1[0-2])月/i);
    return match ? Number(match[1]) : null;
}

function filterSourcesByTargetMonth(sources) {
    const targetMonth = getSelectedImportMonth();
    const kept = [];
    const ignored = [];
    (sources || []).forEach(source => {
        const month = extractLatestFileMonth(getSourceName(source));
        if (month && month !== targetMonth) ignored.push(source);
        else kept.push(source);
    });
    if (ignored.length) {
        logSLAUploadStep('已按目标月份忽略导入文件', {
            targetMonth,
            ignored: ignored.map(getSourceName)
        });
        if (typeof showToast === 'function') {
            showToast(`已按目标月份 ${targetMonth} 月忽略 ${ignored.length} 个其他月份文件`, 'warning');
        }
    }
    return { kept, ignored, targetMonth };
}

function normalizeStructuredRows(name, rows) {
    const suffix = getVersionSuffixFromName(name);
    return (Array.isArray(rows) ? rows : []).map(row => ({
        ...(row && typeof row === 'object' ? row : {}),
        '版本标识': row && row['版本标识'] !== undefined ? row['版本标识'] : (suffix || '主版本(Base)')
    }));
}

async function readSources(sources) {
    const out = [];
    const files = [];
    (sources || []).forEach(source => {
        if (source && Array.isArray(source.__uivRows)) {
            out.push(...normalizeStructuredRows(source.name, source.__uivRows));
        } else if (source) {
            files.push(source);
        }
    });
    if (files.length) out.push(...await readFiles(files));
    return out;
}

async function handleSpecificUploadInternal(e, forceMode) {
    let files = Array.from(e.target.files);
    if (!files.length) return;
    const sourceBatchId = await window.SLASourceArchive.archive(files, { source: 'manual' });
    const monthFilter = filterSourcesByTargetMonth(files);
    files = monthFilter.kept;
    if (!files.length) {
        AppDialog.alert(`所选文件均不是目标月份 ${monthFilter.targetMonth} 月的数据，已忽略导入。`, { title: SLAT('sla.dialog.notice'), tone: 'warning' });
        e.target.value = '';
        return;
    }
    document.getElementById('main-wrapper').innerHTML = `<div class="loading-text">${SLAT('sla.upload.parseLoading')}</div>`;
    document.getElementById('summary-nav-area').style.display = 'none';
    const rawData = await readFiles(files);
    if (!rawData.length) { AppDialog.alert(SLAT('sla.upload.emptyFile'), { title: SLAT('sla.dialog.error'), tone: 'error' }); document.getElementById('main-wrapper').innerHTML = ''; return; }
    document.getElementById('main-wrapper').innerHTML = '';
    resetRuntimeWorkspace();
    const titleMap = {
        rectification: SLAT('sla.section.title.rect'),
        risk: SLAT('sla.section.title.risk'),
        special: SLAT('sla.section.title.special'),
        sr: SLAT('sla.section.title.sr'),
        vulnerability: SLAT('sla.section.title.vuln')
    };
    const colorMap = { rectification: '#1976d2', risk: '#7b1fa2', special: '#00796b', sr: '#d9480f', vulnerability: '#c2410c' };
    const sourceFiles = getSourceNames(files);
    await window.SLASection.initSection(forceMode, forceMode, titleMap[forceMode], rawData, colorMap[forceMode], '', sourceFiles);
    setGlobalRuleBoxCollapsed(true);
    persistWorkspaceCache([{
        secId: forceMode,
        mode: forceMode,
        title: titleMap[forceMode],
        data: rawData,
        themeColor: colorMap[forceMode],
        baseName: '',
        sourceFiles
    }], { type: 'specific', summaryTitle: SLAT('sla.upload.cachedSpecific', { title: titleMap[forceMode] }), files: files.map(f => f.name) });
    API.logHistory('sla', `导入${titleMap[forceMode]}`, `${files.length} 个文件`);
    e.target.value = '';

    // 指标快照直接读取计算结果，不依赖浏览器重绘。
    await captureAndUploadSnapshot(files.map(f => f.name), { source: 'manual', sourceBatchId });
}

async function handleBatchUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    await processBatchFiles(files);
    e.target.value = '';
}

async function processBatchFilesInternal(files, meta = {}) {
    files = Array.from(files || []).filter(Boolean);
    if (!files.length) return;
    const sourceBatchId = await window.SLASourceArchive.archive(files, meta);
    const monthFilter = filterSourcesByTargetMonth(files);
    files = monthFilter.kept;
    if (!files.length) {
        const mainWrapper = document.getElementById('main-wrapper');
        if (mainWrapper) {
            mainWrapper.innerHTML = `<div style="text-align:center;color:#92400e;background:#fffbeb;padding:28px;border:1px solid #fde68a;border-radius:10px;">所选文件均不是目标月份 ${monthFilter.targetMonth} 月的数据，已忽略导入。<br><br><span style="color:#666;font-size:13px;">请切换目标月份或选择对应月份文件后重试。</span></div>`;
        }
        return;
    }
    document.getElementById('main-wrapper').innerHTML = `<div class="loading-text">${SLAT('sla.upload.smartLoading')}</div>`;

    const groups = {
        rectification: { files: [], data: [], title: SLAT('sla.section.title.rectBatch'), mode: 'rectification', color: '#1976d2' },
        risk:          { files: [], data: [], title: SLAT('sla.section.title.riskBatch'), mode: 'risk', color: '#7b1fa2' },
        special:       { files: [], data: [], title: SLAT('sla.section.title.specialBatch'), mode: 'special', color: '#00796b' },
        sr:            { files: [], data: [], title: SLAT('sla.section.title.sr'), mode: 'sr', color: '#d9480f' },
        vulnerability: { files: [], data: [], title: SLAT('sla.section.title.vulnBatch'), mode: 'vulnerability', color: '#c2410c' },
        others: {}
    };

    files.forEach(file => {
        const name = file.name;
        const mode = getMonitoringModeFromName(name);
        if (mode !== 'other') { groups[mode].files.push(file); }
        else {
            let baseName = name;
            const match = name.match(/(.*?Latest)/i);
            if (match) { baseName = match[1]; }
            else { baseName = name.replace(/\.[a-zA-Z0-9]+$/, '').replace(/\s*\(\d+\)$/, ''); }
            if (!groups.others[baseName]) {
                groups.others[baseName] = {
                    id: 'other_' + generateSchemaHash(baseName),
                    files: [], data: [], title: SLAT('sla.section.title.other', { name: baseName }),
                    mode: 'other', color: '#555', baseName
                };
            }
            groups.others[baseName].files.push(file);
        }
    });

    if (groups.rectification.files.length) groups.rectification.data = await readSources(groups.rectification.files);
    if (groups.special.files.length)       groups.special.data       = await readSources(groups.special.files);
    if (groups.risk.files.length)          groups.risk.data          = await readSources(groups.risk.files);
    if (groups.sr.files.length)            groups.sr.data            = await readSources(groups.sr.files);
    if (groups.vulnerability.files.length) groups.vulnerability.data = await readSources(groups.vulnerability.files);
    for (const key in groups.others)       groups.others[key].data   = await readSources(groups.others[key].files);

    document.getElementById('main-wrapper').innerHTML = '';
    resetRuntimeWorkspace();
    const batchTitle = SLAT('sla.upload.batchSuccess', { count: files.length });
    const initPromises = [];
    const cacheSections = [];
    for (const key of SLA_MONITORING_SECTION_ORDER) {
        const g = groups[key];
        if (g.data.length > 0) {
            const sourceFiles = getSourceNames(g.files);
            cacheSections.push({ secId: key, mode: g.mode, title: g.title, data: g.data, themeColor: g.color, baseName: '', sourceFiles });
        }
    }
    Object.values(groups.others).forEach(o => {
        if (o.data.length > 0) {
            const sourceFiles = getSourceNames(o.files);
            cacheSections.push({ secId: o.id, mode: o.mode, title: o.title, data: o.data, themeColor: o.color, baseName: o.baseName, sourceFiles });
        }
    });

    cacheSections.forEach((section, index) => {
        initPromises.push(window.SLASection.initSection(section.secId, section.mode, section.title, section.data, section.themeColor || '#555', section.baseName || '', section.sourceFiles || [], { deferTableRender: index > 0 }));
    });

    const navHtml = buildSectionTabs(cacheSections, batchTitle);
    document.getElementById('summary-nav-area').innerHTML = navHtml;
    document.getElementById('summary-nav-area').style.display = 'block';
    
    // 等待所有表格的数据预处理完成；只有当前标签页渲染明细表 DOM。
    await Promise.all(initPromises);
    activateInitialSection(cacheSections);
    if (cacheSections.length) setGlobalRuleBoxCollapsed(true);
    persistWorkspaceCache(cacheSections, { type: meta.type || 'batch', summaryTitle: meta.summaryTitle || batchTitle, files: files.map(f => f.name), source: meta.source || '' });
    
    API.logHistory('sla', meta.historyAction || '批量导入', `${files.length} 个文件`);
    
    // 所有来源初始化完成后统一计算并保存，不依赖 DOM 重绘时机。
    await captureAndUploadSnapshot(files.map(f => f.name), { source: meta.source || 'manual', sourceBatchId });
}

function getUivAutoImportParams() {
    const params = new URLSearchParams(window.location.search || '');
    const sessionId = params.get('uivImportSession') || '';
    const token = params.get('uivImportToken') || '';
    const targetMonth = parseInt(params.get('targetMonth') || '', 10);
    if (!/^[a-f0-9]{32}$/.test(sessionId) || !/^[a-f0-9]{32}$/.test(token)) return null;
    return { sessionId, token, targetMonth: targetMonth >= 1 && targetMonth <= 12 ? targetMonth : null };
}

function applyAutoImportTargetMonth(targetMonth) {
    if (!(targetMonth >= 1 && targetMonth <= 12)) return;
    if (window.SLATargetMonth && typeof window.SLATargetMonth.set === 'function') {
        window.SLATargetMonth.set(targetMonth);
    }
    const select = document.getElementById('slaTargetMonthSelect');
    if (select) {
        select.value = String(targetMonth);
        select.dataset.ready = 'true';
    }
}

async function importUivAutoSession() {
    const params = getUivAutoImportParams();
    if (!params) return false;
    applyAutoImportTargetMonth(params.targetMonth);
    const mainWrapper = document.getElementById('main-wrapper');
    const summaryNav = document.getElementById('summary-nav-area');
    if (summaryNav) summaryNav.style.display = 'none';
    if (mainWrapper) mainWrapper.innerHTML = `
        <div class="loading-text">${SLAT('sla.upload.uivAutoLoading')}</div>
        <div style="max-width:720px;margin:14px auto;padding:12px 14px;border:1px solid #f59e0b;border-radius:10px;background:#fffbeb;color:#92400e;font-size:13px;font-weight:800;line-height:1.6;text-align:center;">
            ${SLAT('sla.upload.uivTenantWarning')}
        </div>`;
    try {
        const metaUrl = `/api/uiv-auto-import/${encodeURIComponent(params.sessionId)}?token=${encodeURIComponent(params.token)}`;
        const meta = await fetch(metaUrl, { cache: 'no-store' }).then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        });
        const datasets = Array.isArray(meta.datasets) ? meta.datasets : [];
        if (!datasets.length) throw new Error('自动导入会话中没有可导入数据集');
        const sources = datasets.map(dataset => ({
            name: dataset.name || `${dataset.id}.csv`,
            __uivRows: Array.isArray(dataset.rows) ? dataset.rows : []
        })).filter(source => source.__uivRows.length);
        if (!sources.length) throw new Error('自动导入数据集为空');
        await processBatchFiles(sources, {
            type: 'uiv-auto-import',
            source: 'uivf12',
            historyAction: 'UIVF12 自动导入',
            summaryTitle: `📊 UIVF12 自动导入成功 (共解析 ${sources.length} 个数据集)`
        });
        if (typeof showToast === 'function') showToast(`✅ 已自动导入 UIVF12 抓取数据集：${sources.length} 个`);
        const cleanUrl = `${window.location.pathname}${window.location.hash || ''}`;
        window.history.replaceState({}, document.title, cleanUrl);
        return true;
    } catch (err) {
        logSLAUploadError('UIVF12 自动导入', err, params);
        if (mainWrapper) {
            mainWrapper.innerHTML = `<div style="text-align:center;color:#b91c1c;background:#fff5f5;padding:28px;border:1px solid #fecaca;border-radius:10px;">UIVF12 自动导入失败：${escapeHTML(err.message || String(err))}<br><br><span style="color:#666;font-size:13px;">抓取文件仍会保留在浏览器默认下载目录，可手动点击上方批量导入。</span></div>`;
        }
        if (typeof showToast === 'function') showToast(`❌ UIVF12 自动导入失败：${err.message}`, 'error');
        return true;
    }
}

async function captureAndUploadSnapshot(fileNames, meta = {}) {
    window.evaluateAllMetrics?.();
    const snapshot = {
        id: meta.updateId || window.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
        timestamp: new Date().toISOString(),
        files: fileNames,
        importSource: meta.source || 'manual',
        sourceBatchId: meta.sourceBatchId || null,
        sourceSections: Object.entries(window.AppState || {}).filter(([,state]) => state && Array.isArray(state.globalData)).map(([key,state]) => ({ key, mode:state.mode, baseName:state.baseName, schemaHash:state.schemaHash, archiveSupplementary:!!state.archiveSupplementary, title:state.title, sourceFiles:state.sourceFiles || [], headers:state.orderedHeaders || [], rows:state.globalData, rules:state.customMetrics || [] })),
        selectedTargetMonth: window.SLATargetMonth && window.SLATargetMonth.get ? window.SLATargetMonth.get() : (new Date().getMonth() + 1),
        summary: [], 
        topMetrics: [],
        expiringTickets: []
    };

    // 提取在本月底+5天内需要处理的单子
    const now = new Date();
    const targetDate = new Date(now.getFullYear(), now.getMonth() + 1, 5, 23, 59, 59);
    const targetDays = Math.ceil((targetDate - now) / 86400000);
    const collectionsToPush = ['rectification', 'risk', 'special', 'sr', 'vulnerability'];

    collectionsToPush.forEach(secId => {
        if (window.AppState && window.AppState[secId]) {
            const data = window.AppState[secId].globalData || [];
            console.log(`Checking collection: ${secId}, total rows: ${data.length}`);
            data.forEach(row => {
                if (row._slaDays !== undefined && row._slaDays !== 999999 && row._slaDays !== -999999) {
                    if (row._slaDays <= targetDays) {
                        snapshot.expiringTickets.push({
                            collection: secId,
                            title: window.AppState[secId].title,
                            _slaCleanText: row._slaCleanText,
                            _slaDays: row._slaDays,
                            deadline: row._slaDeadline || null,
                            data: row
                        });
                    }
                }
            });
            console.log(`Found ${snapshot.expiringTickets.length} expiring tickets so far.`);
        }
    });
    const collectionOrder = SLA_MONITORING_SECTION_ORDER;
    snapshot.expiringTickets.sort((a, b) => {
        const rankA = collectionOrder.indexOf(String(a && a.collection || ''));
        const rankB = collectionOrder.indexOf(String(b && b.collection || ''));
        const safeRankA = rankA === -1 ? 999 : rankA;
        const safeRankB = rankB === -1 ? 999 : rankB;
        if (safeRankA !== safeRankB) return safeRankA - safeRankB;
        const collectionDiff = String(a && a.collection || '').localeCompare(String(b && b.collection || ''), 'zh-CN');
        if (collectionDiff !== 0) return collectionDiff;
        const daysA = Number(a && a._slaDays);
        const daysB = Number(b && b._slaDays);
        const safeA = Number.isFinite(daysA) ? daysA : 999999;
        const safeB = Number.isFinite(daysB) ? daysB : 999999;
        if (safeA !== safeB) return safeA - safeB;
        return String(a && a.title || '').localeCompare(String(b && b.title || ''), 'zh-CN');
    });

    // 提取各个基础表格面板的数据
    document.querySelectorAll('.dashboard-panel').forEach(panel => {
        if (panel.style.display === 'none') return;
        const section = panel.closest('.section-card');
        const titleEl = section ? section.querySelector('.section-title') : null;
        const secTitle = titleEl ? titleEl.innerText.replace(/\s*\(展示.*\)/, '').trim() : '未知区块';
        const metrics = [];
        panel.querySelectorAll('.metric-card, .metric-total-wrapper').forEach(card => {
            const title = card.querySelector('.metric-title')?.innerText || '';
            const value = card.querySelector('.metric-value')?.innerText || '';
            let status = '';
            if (value.includes('✅') || value.includes('⚠️')) {
                // 如果有附加状态(如"达标/落后")
                const b = card.querySelector('b') || card.querySelector('div:nth-child(2)');
                if (b) status = b.innerText.trim();
            }
            if (title && value) metrics.push({ title: title.replace('🌟 ', ''), value: value.replace(/\n/g, ' ').trim(), status });
        });
        if (metrics.length) {
            snapshot.summary.push({ section: secTitle, metrics });
        }
    });

    // 用计算结果保存全部指标和子指标，折叠、隐藏或尚未重绘的页面不影响快照。
    Object.entries(window.GlobalMetrics || {}).forEach(([metricKey, metric]) => {
        const { label, value } = metric;
        const target = window.GlobalTargets?.[metricKey];
        const { isWarn, gap } = window.SLAMetrics.getMetricWarningState(metric, target, snapshot.selectedTargetMonth);
        const color = isWarn ? '#ef5350' : ({ success: '#81c784', warn: '#ffb74d', danger: '#ef5350' }[metric.color] || '#4fc3f7');
        const subMetrics = (metric.subMetrics || []).map(child => ({ category: child.category, value: String(child.value) }));
        const sectionEntry = Object.entries(window.AppState || {}).find(([secId, state]) => (state.customMetrics || []).some(rule => `${secId}_${rule.id}` === metricKey));
        const sectionKey = sectionEntry?.[0];
        const state = sectionEntry?.[1];
        const rule = (state?.customMetrics || []).find(rule => `${sectionKey}_${rule.id}` === metricKey);
        const sourceSections = state ? (rule?.scope === 'all' ? snapshot.sourceSections.filter(section => !section.archiveSupplementary) : snapshot.sourceSections.filter(section => section.key === sectionKey)) : [];
        const sourceFiles = [...new Set(sourceSections.flatMap(section => section.sourceFiles || []))];
        let firstRowFound = false;
        const sourceSelections = sourceSections.map(section => ({ sectionKey: section.key, indexes: section.rows.flatMap((row, index) => {
            if (!rule || typeof metricRuleRowMatches !== 'function' || !metricRuleRowMatches(row, rule, true)) return [];
            if (rule.type === 'count' && !metricRuleCellMatches(row[rule.colZ], rule.valK)) return [];
            if (!['count', 'ratio', 'extract_multi'].includes(rule.type)) { if (firstRowFound) return []; firstRowFound = true; }
            return [index];
        }) }));
        for (const child of subMetrics) {
            const childRule = (rule?.subMetrics || []).find(item => item.category === child.category);
            const cross = childRule?.scope === 'all' || (!childRule?.scope && rule?.scope === 'all');
            const childSection = childRule?.sourceSecId || sectionKey;
            const childSources = childRule ? snapshot.sourceSections.filter(section => cross ? !section.archiveSupplementary : section.key === childSection) : [];
            child.sourceLinkVersion = 2;
            child.sourceSection = childSection || '';
            child.sourceSectionKeys = childSources.map(section => section.key);
            child.sourceFiles = [...new Set(childSources.flatMap(section => section.sourceFiles || []))];
        }
        snapshot.topMetrics.push({ key: metricKey, label, value: String(value), gap, isWarn, color, subMetrics, sourceSection: sectionKey || '', sourceLinkVersion: 2, sourceSectionKeys: sourceSections.map(section => section.key), sourceFiles, rule: rule || null, sourceSelections, savedTarget: target?.[snapshot.selectedTargetMonth] ?? null });
    });

    const snapshotStats = {
        requestBytes: getJSONBytes(snapshot),
        files: snapshot.files.length,
        summaryCount: snapshot.summary.length,
        topMetricCount: snapshot.topMetrics.length,
        expiringTicketCount: snapshot.expiringTickets.length
    };

    try {
        logSLAUploadStep('开始上传历史快照', snapshotStats);
        await API[meta.updateId?'put':'post'](meta.updateId?'/api/sla/snapshots/'+encodeURIComponent(meta.updateId):'/api/sla/snapshot', snapshot);
        logSLAUploadStep('历史快照上传成功', snapshotStats);
        if(!meta.ruleRefresh)showToast('✅ 预警结果已生成历史快照并存档');
    } catch (e) {
        logSLAUploadError('普通历史快照上传链路', e, snapshotStats);
        console.error('Snapshot upload failed', e);

        if (!isSLACompressionSupported()) {
            showToast('⚠️ 历史快照上传失败，当前浏览器不支持压缩重试', 'warning');
        } else {
            try {
                logSLAUploadStep('普通快照上传失败，开始构建 gzip 压缩重试请求');
                const compressedBody = await buildCompressedSnapshotBody(snapshot, 'gzip');
                const compressedStats = {
                    requestBytes: getJSONBytes(compressedBody),
                    originalBytes: compressedBody.transport.originalBytes,
                    compressedBytes: compressedBody.transport.compressedBytes,
                    files: snapshot.files.length,
                    expiringTicketCount: snapshot.expiringTickets.length
                };
                logSLAUploadStep('gzip 压缩快照请求已构建', compressedStats);

                await API[meta.updateId?'put':'post'](meta.updateId?'/api/sla/snapshots/'+encodeURIComponent(meta.updateId):'/api/sla/snapshot', compressedBody);
                logSLAUploadStep('gzip 压缩快照重试成功', compressedStats);
                if(!meta.ruleRefresh)showToast('✅ 预警结果已通过压缩重试生成历史快照并存档');
            } catch (retryError) {
                logSLAUploadError('gzip 压缩快照重试链路', retryError, {
                    files: snapshot.files.length,
                    expiringTicketCount: snapshot.expiringTickets.length
                });
                showToast('⚠️ 预警结果已生成并在本地生效，历史快照存档未成功（网络拦截或无权限）', 'warning');
            }
        }
    }
    if(!meta.ruleRefresh){
        const context={files:fileNames,source:meta.source||'manual',sourceBatchId:snapshot.sourceBatchId,month:snapshot.selectedTargetMonth};
        window.SLAMetricSnapshotSync?.bind(context);
        try{const cached=JSON.parse(localStorage.getItem(SLA_WORKSPACE_CACHE_KEY)||'null');if(cached){cached.meta.metricSnapshotContext={...context,fingerprint:window.SLAMetricSnapshotSync?.fingerprint()};localStorage.setItem(SLA_WORKSPACE_CACHE_KEY,JSON.stringify(cached));}}catch(_){}
    }
    window.MonthlyMetricUpdates?.notify();
    return snapshot;
}

async function handleSpecificUpload(e, mode) { return window.SLASourceArchive.withLock(() => handleSpecificUploadInternal(e, mode)); }
async function processBatchFiles(files, meta = {}) { return window.SLASourceArchive.withLock(() => processBatchFilesInternal(files, meta)); }

function renderArchiveReviewNotice(meta) {
    const nav = document.getElementById('summary-nav-area');
    if (!nav) return;
    const savedAt = new Date(meta.sourceTimestamp).toLocaleString(window.ToolsI18n?.getLanguage?.() === 'en-US' ? 'en-US' : 'zh-CN', { hour12:false });
    const heading = nav.querySelector('.sla-section-tabs-title');
    if (heading) heading.textContent = SLAT('sla.history.reviewTitle', { time:savedAt });
    let note = nav.querySelector('.sla-archive-review-note');
    if (!note) {
        note = document.createElement('div');
        note.className = 'sla-archive-review-note';
        note.style.cssText = 'padding:10px 14px;margin-bottom:10px;border:1px solid #93c5fd;border-radius:8px;color:var(--text-color,#1565c0);background:var(--bg-secondary,#eff6ff);line-height:1.6;font-size:13px';
        nav.prepend(note);
    }
    note._reviewMeta = meta;
    note.textContent = SLAT('sla.history.reviewNote', { files:meta.originalFileCount, sheets:meta.worksheetCount });
}
window.addEventListener?.('tools:languagechange', () => {
    const note = document.querySelector('.sla-archive-review-note');
    if (note?._reviewMeta) renderArchiveReviewNotice(note._reviewMeta);
});

function archivedImportDescriptor(file, saved) {
    const known = ['rectification','risk','special','sr','vulnerability'];
    let mode = saved?.mode || (known.includes(saved?.key) ? saved.key : '');
    if (!mode) mode = getMonitoringModeFromName(file.name);
    const baseName = mode==='other' ? (saved?.baseName || file.name.match(/(.*?Latest)/i)?.[1] || file.name.replace(/\.[a-zA-Z0-9]+$/, '').replace(/\s*\(\d+\)$/, '')) : '';
    const titles = {rectification:'sla.section.title.rectBatch',risk:'sla.section.title.riskBatch',special:'sla.section.title.specialBatch',sr:'sla.section.title.sr',vulnerability:'sla.section.title.vulnBatch'};
    return {secId:saved?.key || (mode==='other'?'other_'+generateSchemaHash(baseName):mode),mode,title:saved?.title || (mode==='other'?SLAT('sla.section.title.other',{name:baseName}):SLAT(titles[mode])),themeColor:{rectification:'#1976d2',risk:'#7b1fa2',special:'#00796b',sr:'#d9480f',vulnerability:'#c2410c'}[mode]||'#555',baseName,originalSchemaHash:saved?.schemaHash||'',savedRules:saved?.rules||[],sourceFiles:[],data:[]};
}

async function loadArchivedSnapshot(snapshot, options = {}) {
    if (!options.fromCacheRestore) archiveReviewRequested = true;
    if (!options.fromCacheRestore && workspaceRestorePromise) await workspaceRestorePromise;
    return window.SLASourceArchive.withLock(async () => {
        if (!Array.isArray(snapshot.sourceSections) && snapshot.id) {
            const archived = await API.get('/api/upload/source-snapshots/' + encodeURIComponent(snapshot.id)).catch(() => null);
            if (archived?.sourceBatchId) snapshot = {...snapshot,...archived};
        }
        const catalog = await API.get('/api/upload/source-catalog');
        const files = (catalog.files || []).filter(file => file.batch_id === snapshot.sourceBatchId);
        if (!snapshot.sourceBatchId || !files.length) throw new Error(SLAT('sla.history.noOriginals'));
        // Read everything first so a download/parse error leaves the current workspace intact.
        const primary=new Map(),supplementary=[];
        let worksheetCount=0;
        for (const file of files) {
            const sheets = await window.SLASourceArchive.readArchivedWorksheets(file);
            worksheetCount+=sheets.length;
            const saved=(snapshot.sourceSections||[]).find(section=>(section.sourceFiles||[]).includes(file.name));
            const included=saved || !(snapshot.files||[]).length || snapshot.files.includes(file.name);
            for (const [index,sheet] of sheets.entries()) {
                if (index===0 && included) {
                    const descriptor=archivedImportDescriptor(file,saved);
                    if (!primary.has(descriptor.secId)) primary.set(descriptor.secId,descriptor);
                    const section=primary.get(descriptor.secId);
                    section.sourceFiles.push(file.name);
                    section.data.push(...normalizeStructuredRows(file.name,sanitizeWorkspaceRows(sheet.rows)));
                } else supplementary.push({
                    secId:'other_archive_'+generateSchemaHash(file.id+'@@'+sheet.name),
                    mode:'other',title:file.name+' / '+sheet.name,data:sanitizeWorkspaceRows(sheet.rows),themeColor:'#1565c0',
                    baseName:file.name+' / '+sheet.name,sourceFiles:[file.name],archiveSupplementary:true
                });
            }
        }
        const sections=sortArchiveReviewSections([...primary.values(),...supplementary]);
        if (!sections.length) throw new Error(SLAT('sla.history.noWorksheets'));
        const main = document.getElementById('main-wrapper');
        const nav = document.getElementById('summary-nav-area');
        main.innerHTML = '';
        resetRuntimeWorkspace();
        await Promise.all(sections.map((section, index) => window.SLASection.initSection(section.secId, section.mode, section.title, section.data, section.themeColor, section.baseName, section.sourceFiles, { deferTableRender: index > 0, reviewOnly: true, originalSchemaHash:section.originalSchemaHash, savedRules:section.savedRules, archiveSupplementary:section.archiveSupplementary })));
        if (snapshot.selectedTargetMonth) window.SLATargetMonth?.set?.(snapshot.selectedTargetMonth);
        if (typeof evaluateAllMetrics==='function') evaluateAllMetrics();
        const savedAt = new Date(snapshot.timestamp).toLocaleString(window.ToolsI18n?.getLanguage?.() === 'en-US' ? 'en-US' : 'zh-CN', { hour12: false });
        const title = SLAT('sla.history.reviewTitle', { time: savedAt });
        nav.innerHTML = buildSectionTabs(sections, title);
        nav.style.display = 'block';
        const reviewMeta = { type:'archive-review', archiveNamesVersion:1, reviewMonitoringVersion:1, selectedTargetMonth:snapshot.selectedTargetMonth, summaryTitle:title, files:files.map(file=>file.name), sourceSnapshotId:snapshot.id, sourceTimestamp:snapshot.timestamp, originalFileCount:files.length, worksheetCount };
        renderArchiveReviewNotice(reviewMeta);
        const archiveStatus = document.getElementById('sourceArchiveStatus');
        if (archiveStatus) {
            archiveStatus.textContent = SLAT('sla.history.originalsLoaded');
            if (typeof window.updateUploadStatusVisibility === 'function') window.updateUploadStatusVisibility();
        }
        activateInitialSection(sections);
        setGlobalRuleBoxCollapsed(true);
        reviewMeta.metricSnapshotContext={files:files.map(file=>file.name),source:'archive-review',sourceBatchId:snapshot.sourceBatchId,month:snapshot.selectedTargetMonth};
        window.SLAMetricSnapshotSync?.bind(reviewMeta.metricSnapshotContext);
        reviewMeta.metricSnapshotContext.fingerprint=window.SLAMetricSnapshotSync?.fingerprint();
        persistWorkspaceCache(sections, reviewMeta);
        return { files:files.length, sheets:worksheetCount };
    });
}

window.SLAUpload = { captureAndUploadSnapshot, handleBatchUpload, handleSpecificUpload, processBatchFiles, loadArchivedSnapshot, importUivAutoSession, readFiles, generateSchemaHash, restoreCachedWorkspace, clearWorkspaceCache, dismissWorkspaceCacheNotice, activateSectionTab, isRuntimeField, sanitizeWorkspaceRow, sanitizeWorkspaceRows, RECT_PRIORITY_COLS, RISK_PRIORITY_COLS, SPECIAL_PRIORITY_COLS, SR_PRIORITY_COLS, VULN_PRIORITY_COLS };
