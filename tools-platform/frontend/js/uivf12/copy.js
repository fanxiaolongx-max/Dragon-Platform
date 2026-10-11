/**
 * uivf12/copy.js - 复制功能模块
 * 负责：代码复制到剪贴板、批量阵列打包生成
 */

const UIV_BATCH_SPEED_KEY = 'uivf12_batch_speed';
const UIV_BATCH_EXCLUDED_CATEGORIES_KEY = 'uivf12_batch_excluded_categories';
const UIV_BATCH_SCHEDULE_KEY = 'uivf12_batch_schedule';
const UIV_BATCH_SPEEDS = [1, 2, 4];
let uivBatchScheduleTimer = null;
let uivBatchScheduledRunActive = false;

function escapeUivHtml(value) {
    return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));
}

function copyCodeText(textAreaId, btnId, typeName) {
    const codeEl = document.getElementById(textAreaId);
    if (!codeEl || !codeEl.value) { alert(UIVT('uiv.copy.noCode')); return; }
    codeEl.select();
    document.execCommand('copy');
    const btn = document.getElementById(btnId);
    const oldText = btn.innerText;
    btn.innerText = UIVT('uiv.copy.successButton');
    setTimeout(() => btn.innerText = oldText, 2000);
    showToast(UIVT('uiv.copy.toast', { type: typeName }));
}

function copyFromMemory(codeStr, typeName) {
    const t = document.createElement('textarea');
    t.value = codeStr;
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    document.body.removeChild(t);
    showToast(UIVT('uiv.copy.memoryToast', { type: typeName }));
}

async function copyAllConsoleScripts() {
    try {
        const { scripts } = await API.get('/api/uiv/scripts');
        const scope = applyUivBatchCategoryFilter(scripts || []);
        buildAndCopyMasterScript(scope.scripts, scope.groupName);
    } catch (e) {
        showToast(e.message || UIVT('uiv.copy.fetchFail'), 'error');
    }
}

async function copyAllUivScripts() {
    try {
        const { scripts } = await API.get('/api/uiv/scripts');
        const scope = applyUivBatchCategoryFilter(scripts || []);
        buildAndCopyUivBatchMacro(scope.scripts, scope.groupName, getUivBatchSpeed());
    } catch (e) {
        showToast(e.message || UIVT('uiv.copy.fetchFail'), 'error');
    }
}

function getUivScriptCategory(script) {
    return String(script && script.category || '默认分类').trim() || '默认分类';
}

function readUivBatchExcludedCategories() {
    try {
        const parsed = JSON.parse(localStorage.getItem(UIV_BATCH_EXCLUDED_CATEGORIES_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch (error) {
        return [];
    }
}

function writeUivBatchExcludedCategories(categories) {
    const unique = Array.from(new Set((categories || []).map(String).filter(Boolean))).sort();
    localStorage.setItem(UIV_BATCH_EXCLUDED_CATEGORIES_KEY, JSON.stringify(unique));
    return unique;
}

function readUivBatchSchedule() {
    try {
        const parsed = JSON.parse(localStorage.getItem(UIV_BATCH_SCHEDULE_KEY) || '{}');
        const intervalMinutes = Math.max(5, Number(parsed.intervalMinutes) || 60);
        return { enabled: parsed.enabled === true, intervalMinutes, lastRunAt: Number(parsed.lastRunAt) || 0 };
    } catch (error) {
        return { enabled: false, intervalMinutes: 60, lastRunAt: 0 };
    }
}

function writeUivBatchSchedule(schedule) {
    const normalized = {
        enabled: schedule && schedule.enabled === true,
        intervalMinutes: Math.max(5, Number(schedule && schedule.intervalMinutes) || 60),
        lastRunAt: Number(schedule && schedule.lastRunAt) || 0
    };
    localStorage.setItem(UIV_BATCH_SCHEDULE_KEY, JSON.stringify(normalized));
    return normalized;
}

function renderUivBatchScheduleSettings() {
    const schedule = readUivBatchSchedule();
    const enabled = document.getElementById('uiv-batch-schedule-enabled');
    const interval = document.getElementById('uiv-batch-schedule-interval');
    if (enabled) enabled.checked = schedule.enabled;
    if (interval) interval.value = String(schedule.intervalMinutes);
}

function getUivBatchCategoryStats(scripts = [], categories = []) {
    const stats = new Map();
    categories.forEach(category => stats.set(String(category), 0));
    (scripts || []).forEach(script => {
        const category = getUivScriptCategory(script);
        stats.set(category, (stats.get(category) || 0) + 1);
    });
    return Array.from(stats.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

function applyUivBatchCategoryFilter(scripts = []) {
    const excluded = new Set(readUivBatchExcludedCategories());
    const filtered = (scripts || []).filter(script => !excluded.has(getUivScriptCategory(script)));
    if (!filtered.length) {
        throw new Error('当前批脚本执行范围没有可运行脚本，请在分类范围中至少勾选一个有脚本的分类。');
    }
    const allGroup = UIVT('uiv.copy.allGroup');
    if (!excluded.size || filtered.length === scripts.length) {
        return { scripts: filtered, groupName: allGroup, excluded: [] };
    }
    const selectedCategories = Array.from(new Set(filtered.map(getUivScriptCategory))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return {
        scripts: filtered,
        groupName: `选中分类-${selectedCategories.length}类`,
        excluded: Array.from(excluded)
    };
}

function getBatchFilterCheckedCategories() {
    return Array.from(document.querySelectorAll('.uiv-batch-filter-check'))
        .filter(input => input.checked)
        .map(input => input.value);
}

function setBatchFilterChecks(checked) {
    const checkedSet = new Set(checked);
    document.querySelectorAll('.uiv-batch-filter-check').forEach(input => {
        input.checked = checkedSet.has(input.value);
    });
}

async function openUivBatchCategoryFilter() {
    try {
        const { scripts = [], categories = [] } = await API.get('/api/uiv/scripts');
        const stats = getUivBatchCategoryStats(scripts, categories);
        if (!stats.length) {
            showToast('当前仓库还没有分类可配置。', 'error');
            return;
        }
        const excluded = new Set(readUivBatchExcludedCategories());
        const selectedCount = stats.filter(item => !excluded.has(item.name)).length;
        let overlay = document.getElementById('uiv-batch-filter-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'uiv-batch-filter-overlay';
            overlay.className = 'uiv-batch-filter-overlay';
            overlay.addEventListener('click', event => {
                if (event.target === overlay) closeUivBatchCategoryFilter();
            });
            document.body.appendChild(overlay);
        }
        overlay.innerHTML = `
            <div class="uiv-batch-filter-dialog">
                <div class="uiv-batch-filter-header">
                    <div>
                        <h3>批脚本执行范围</h3>
                        <p>默认执行全部分类；取消勾选后，“运行批脚本”和“拷贝全部批量阵列”会跳过对应分类。</p>
                    </div>
                    <button class="uiv-batch-filter-close" onclick="UIVCopy.closeUivBatchCategoryFilter()">×</button>
                </div>
                <div class="uiv-batch-filter-body">
                    <div class="uiv-batch-filter-tools">
                        <button onclick="UIVCopy.selectAllUivBatchCategories()">全选</button>
                        <button onclick="UIVCopy.clearAllUivBatchCategories()">全不选</button>
                        <button onclick="UIVCopy.resetUivBatchCategoryFilter()">恢复默认全量</button>
                    </div>
                    <div class="uiv-batch-filter-list">
                        ${stats.map(item => `
                            <label class="uiv-batch-filter-item">
                                <input class="uiv-batch-filter-check" type="checkbox" value="${escapeUivHtml(item.name)}" ${excluded.has(item.name) ? '' : 'checked'}>
                                <span>${escapeUivHtml(window.UIVI18n ? UIVI18n.categoryLabel(item.name) : item.name)}</span>
                                <small>${item.count} 个脚本</small>
                            </label>
                        `).join('')}
                    </div>
                    <div style="margin-top:14px;padding:12px;border:1px solid rgba(103,232,249,.28);border-radius:10px;background:rgba(8,47,73,.24);">
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                            <div><strong style="color:#cffafe;">⏱️ 运行周期</strong><p style="margin:4px 0 0;color:#94a3b8;font-size:11px;">默认关闭。开启后需保持数据抓取页打开；每轮复用同一个启动页，避免窗口累积。</p></div>
                            <label style="display:flex;align-items:center;gap:6px;color:#e2e8f0;font-size:12px;white-space:nowrap;"><input id="uiv-batch-schedule-enabled" type="checkbox"> 开启</label>
                        </div>
                        <label style="display:flex;align-items:center;gap:8px;margin-top:10px;color:#cbd5e1;font-size:12px;">每隔
                            <select id="uiv-batch-schedule-interval" style="flex:1;padding:6px;border-radius:7px;border:1px solid #475569;background:#0f172a;color:#e2e8f0;">
                                <option value="30">30 分钟</option><option value="60">1 小时</option><option value="120">2 小时</option><option value="240">4 小时</option><option value="480">8 小时</option><option value="720">12 小时</option><option value="1440">24 小时</option>
                            </select>运行一次
                        </label>
                    </div>
                </div>
                <div class="uiv-batch-filter-footer">
                    <button onclick="UIVCopy.closeUivBatchCategoryFilter()">取消</button>
                    <button class="primary" onclick="UIVCopy.saveUivBatchCategoryFilter()">保存范围</button>
                </div>
            </div>
        `;
        overlay.style.display = 'flex';
        renderUivBatchScheduleSettings();
        showToast(`当前批脚本范围：${selectedCount}/${stats.length} 个分类`, 'success');
    } catch (error) {
        showToast(`❌ 打开批脚本范围失败：${error.message}`, 'error');
    }
}

function closeUivBatchCategoryFilter() {
    const overlay = document.getElementById('uiv-batch-filter-overlay');
    if (overlay) overlay.style.display = 'none';
}

function selectAllUivBatchCategories() {
    document.querySelectorAll('.uiv-batch-filter-check').forEach(input => { input.checked = true; });
}

function clearAllUivBatchCategories() {
    document.querySelectorAll('.uiv-batch-filter-check').forEach(input => { input.checked = false; });
}

function resetUivBatchCategoryFilter() {
    writeUivBatchExcludedCategories([]);
    selectAllUivBatchCategories();
    showToast('✅ 已恢复默认：执行全部分类脚本', 'success');
}

function saveUivBatchCategoryFilter() {
    const inputs = Array.from(document.querySelectorAll('.uiv-batch-filter-check'));
    if (!inputs.length) return;
    const checked = new Set(getBatchFilterCheckedCategories());
    const excluded = inputs.filter(input => !checked.has(input.value)).map(input => input.value);
    writeUivBatchExcludedCategories(excluded);
    const previousSchedule = readUivBatchSchedule();
    const scheduleEnabled = document.getElementById('uiv-batch-schedule-enabled')?.checked === true;
    if (scheduleEnabled && !previousSchedule.enabled) {
        const scheduledWindow = window.open('about:blank', 'uivf12-scheduled-runner');
        if (scheduledWindow) {
            scheduledWindow.document.title = 'UIVF12 定时运行等待页';
            scheduledWindow.document.body.innerHTML = '<div style="font-family:Arial,sans-serif;padding:24px;color:#334155"><h2>UIVF12 定时运行已开启</h2><p>此窗口会在到达运行周期时复用，请勿手动关闭。</p></div>';
        } else {
            showToast('⚠️ 浏览器拦截了定时启动页，请允许本站弹窗后重新开启定时运行。', 'error');
        }
    }
    const schedule = writeUivBatchSchedule({
        enabled: scheduleEnabled,
        intervalMinutes: Number(document.getElementById('uiv-batch-schedule-interval')?.value) || 60,
        lastRunAt: scheduleEnabled && !previousSchedule.enabled ? Date.now() : previousSchedule.lastRunAt
    });
    startUivBatchSchedule();
    closeUivBatchCategoryFilter();
    const selected = inputs.length - excluded.length;
    showToast(`✅ 批脚本范围已保存：执行 ${selected}/${inputs.length} 个分类；定时运行${schedule.enabled ? `每 ${schedule.intervalMinutes} 分钟` : '已关闭'}`, 'success');
}

function startUivBatchSchedule() {
    if (uivBatchScheduleTimer) clearInterval(uivBatchScheduleTimer);
    uivBatchScheduleTimer = null;
    const schedule = readUivBatchSchedule();
    if (!schedule.enabled) return;
    if (!schedule.lastRunAt) writeUivBatchSchedule({ ...schedule, lastRunAt: Date.now() });
    const check = async () => {
        const current = readUivBatchSchedule();
        if (!current.enabled || uivBatchScheduledRunActive) return;
        const dueAt = (current.lastRunAt || 0) + current.intervalMinutes * 60 * 1000;
        if (Date.now() < dueAt) return;
        uivBatchScheduledRunActive = true;
        try {
            const started = await runAllUivScriptsDirect({ scheduled: true });
            if (started) writeUivBatchSchedule({ ...current, lastRunAt: Date.now() });
        } finally {
            uivBatchScheduledRunActive = false;
        }
    };
    uivBatchScheduleTimer = setInterval(check, 30000);
    check();
}

function getUivBatchSpeed() {
    const raw = Number(localStorage.getItem(UIV_BATCH_SPEED_KEY) || '1');
    return UIV_BATCH_SPEEDS.includes(raw) ? raw : 1;
}

function getUivCooldownMs(speed = getUivBatchSpeed()) {
    return Math.max(750, Math.round(3000 / speed));
}

function updateUivBatchSpeedButton() {
    const btn = document.querySelector('.btn-batch-speed');
    if (!btn) return;
    const speed = getUivBatchSpeed();
    const seconds = getUivCooldownMs(speed) / 1000;
    btn.textContent = speed + 'x';
    btn.title = UIVT('uiv.repo.batchSpeedTitle', { speed, seconds });
}

function cycleUivBatchSpeed() {
    const current = getUivBatchSpeed();
    const next = UIV_BATCH_SPEEDS[(UIV_BATCH_SPEEDS.indexOf(current) + 1) % UIV_BATCH_SPEEDS.length];
    localStorage.setItem(UIV_BATCH_SPEED_KEY, String(next));
    updateUivBatchSpeedButton();
    showToast(UIVT('uiv.repo.batchSpeedToast', { speed: next, seconds: getUivCooldownMs(next) / 1000 }), 'success');
}

function registerUivAutoImportBridge(autoImport) {
    if (!autoImport || !autoImport.sessionId || !autoImport.token) return;
    window.__uivf12AutoImportBridgeSessions = window.__uivf12AutoImportBridgeSessions || {};
    window.__uivf12AutoImportBridgeSessions[autoImport.sessionId] = autoImport;
    window.__uivf12AutoImportBridgeNameCounts = window.__uivf12AutoImportBridgeNameCounts || {};
    if (window.__uivf12AutoImportBridgeBound) return;
    window.__uivf12AutoImportBridgeBound = true;
    function rowsFromTable(table) {
        const headers = Array.isArray(table && table.headers) ? table.headers : [];
        const values = Array.isArray(table && table.values) ? table.values : [];
        if (!headers.length || !values.length) return [];
        return values
            .filter(row => Array.isArray(row) && row.some(value => String(value || '').trim() !== ''))
            .map(row => {
                const obj = {};
                headers.forEach((header, index) => {
                    obj[String(header || ('列' + (index + 1))).trim() || ('列' + (index + 1))] = row[index] !== undefined ? row[index] : '';
                });
                return obj;
            });
    }
    function uniquifyUploadName(sessionId, name) {
        const baseName = String(name || 'uivf12_capture.csv');
        const key = `${sessionId}::${baseName}`;
        const count = window.__uivf12AutoImportBridgeNameCounts[key] || 0;
        window.__uivf12AutoImportBridgeNameCounts[key] = count + 1;
        if (count === 0) return baseName;
        const dot = baseName.lastIndexOf('.');
        if (dot > 0 && dot > baseName.lastIndexOf('/')) {
            return `${baseName.slice(0, dot)} (${count})${baseName.slice(dot)}`;
        }
        return `${baseName} (${count})`;
    }
    function makeBridgeUploadId() {
        const bytes = new Uint8Array(8);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }
    function chunkRows(rows, maxRows = 12, maxBytes = 22000) {
        const chunks = [];
        let current = [];
        let currentBytes = 0;
        rows.forEach(row => {
            const rowBytes = (() => { try { return JSON.stringify(row).length; } catch (e) { return 1024; } })();
            if (current.length && (current.length >= maxRows || currentBytes + rowBytes > maxBytes)) {
                chunks.push(current);
                current = [];
                currentBytes = 0;
            }
            current.push(row);
            currentBytes += rowBytes;
        });
        if (current.length) chunks.push(current);
        return chunks;
    }
    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    async function postJsonWithRetry(url, payload, options = {}) {
        const attempts = options.attempts || 3;
        let lastError = null;
        for (let attempt = 0; attempt < attempts; attempt++) {
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await res.json().catch(() => ({}));
                if (res.ok) return result;
                lastError = new Error(`HTTP ${res.status}: ${result.error || res.statusText || 'upload failed'}`);
                if (![408, 429, 500, 502, 503, 504].includes(res.status)) throw lastError;
            } catch (error) {
                lastError = error;
            }
            if (attempt < attempts - 1) await wait(700 * (attempt + 1));
        }
        throw lastError || new Error('upload failed');
    }
    async function postDatasetRows(session, uploadName, rows, meta) {
        const chunks = chunkRows(rows);
        const clientUploadId = makeBridgeUploadId();
        let latestResult = null;
        for (let index = 0; index < chunks.length; index++) {
            try {
                latestResult = await postJsonWithRetry(session.uploadUrl, {
                    name: uploadName,
                    rows: chunks[index],
                    append: true,
                    clientUploadId,
                    chunkIndex: index,
                    chunkCount: chunks.length,
                    origin: meta.origin || '',
                    groupName: session.groupName || meta.groupName || ''
                });
            } catch (error) {
                throw new Error(`${error && error.message ? error.message : 'upload failed'} (chunk ${index + 1}/${chunks.length})`);
            }
        }
        return latestResult || {};
    }
    window.addEventListener('message', async event => {
        const data = event.data || {};
        if (!data || data.type !== 'uivf12-auto-import-dataset') return;
        const sessions = window.__uivf12AutoImportBridgeSessions || {};
        const session = sessions[data.sessionId];
        if (!session || session.token !== data.token) return;

        const reply = payload => {
            try {
                if (event.source && typeof event.source.postMessage === 'function') {
                    event.source.postMessage(Object.assign({
                        type: 'uivf12-auto-import-ack',
                        requestId: data.requestId,
                        sessionId: data.sessionId
                    }, payload), event.origin || '*');
                }
            } catch (e) {}
        };

        try {
            const rows = data.table ? rowsFromTable(data.table) : (Array.isArray(data.rows) ? data.rows : []);
            if (!rows.length) throw new Error('缺少结构化 rows 数据');
            const uploadName = uniquifyUploadName(data.sessionId, data.name);
            const result = await postDatasetRows(session, uploadName, rows, {
                origin: data.origin || event.origin || '',
                groupName: data.groupName || ''
            });
            reply({ ok: true, result });
        } catch (error) {
            console.warn('[UIVF12 Auto Import Bridge] upload failed:', data.name, error);
            reply({
                ok: false,
                error: error.message || '自动导入桥接上传失败',
                detail: {
                    name: data.name || '',
                    rowCount: data.table && Array.isArray(data.table.values) ? data.table.values.length : (Array.isArray(data.rows) ? data.rows.length : 0),
                    headerCount: data.table && Array.isArray(data.table.headers) ? data.table.headers.length : 0,
                    approxBytes: (() => { try { return JSON.stringify(data.table || data.rows || []).length; } catch (e) { return 0; } })()
                }
            });
        }
    });
}

function getUivOpenUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl || '');
        return `${parsed.origin}/`;
    } catch (e) {
        return '';
    }
}

function resolveUivOpenUrl(script, resolvedUrl) {
    if (script && script.openUrl) {
        try {
            const parsed = new URL(script.openUrl);
            if (['http:', 'https:'].includes(parsed.protocol)) return parsed.toString();
        } catch (e) {}
    }
    return getUivOpenUrl(resolvedUrl);
}

function extractUrlFromCode(code) {
    const text = String(code || '');
    const commentMatch = text.match(/URL:\s*(https?:\/\/[^\s]+)/);
    if (commentMatch) return commentMatch[1];
    const fetchMatch = text.match(/fetch\("([^"]+)"/);
    if (fetchMatch) return fetchMatch[1];
    return '';
}

function resolveUivScriptUrl(script) {
    return script.url || extractUrlFromCode(script.code) || extractUrlFromCode(script.consoleCode);
}

function getUivSiteDisplayName(origin) {
    let host = '';
    try { host = new URL(origin).hostname.toLowerCase(); } catch (e) {}
    if (host === 'netcare.huawei.com') return 'NetCare 中国';
    if (host === 'netcare-ae.gts.huawei.com') return 'NetCare 中东';
    if (host === 'netcare-de.gts.huawei.com') return 'NetCare 德国';
    if (host.includes('datafab')) return 'DataFab';
    return host || '未识别站点';
}

function groupConsoleScriptsBySite(scripts) {
    const siteMap = new Map();
    const unresolved = [];
    (scripts || []).forEach(script => {
        const resolvedUrl = resolveUivScriptUrl(script);
        const openUrl = resolveUivOpenUrl(script, resolvedUrl);
        let origin = '';
        try { origin = new URL(openUrl || resolvedUrl || '').origin; } catch (e) {}
        if (!origin) {
            unresolved.push(script);
            return;
        }
        if (!siteMap.has(origin)) siteMap.set(origin, []);
        siteMap.get(origin).push(script);
    });
    return {
        sites: Array.from(siteMap.entries())
            .map(([origin, siteScripts]) => ({
                origin,
                name: getUivSiteDisplayName(origin),
                scripts: siteScripts
            }))
            .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
        unresolved
    };
}

function closeSiteConsoleScriptPicker() {
    const overlay = document.getElementById('uiv-site-script-overlay');
    if (overlay) overlay.remove();
}

function getTopicSimulatorConfig(origin) {
    if (origin === 'https://netcare.huawei.com') return { kind: 'netcare', name: 'NetCare 中国', api: window.UIVNetCareAnalysis, launcher: '.nc-head-button' };
    if (origin === 'https://datafab-pro.gtsdata.huawei.com') return { kind: 'datafab', name: 'DataFab', api: window.UIVDataFabAnalysis, launcher: '.df-head-button' };
    return null;
}

function closeTopicFloatingSimulator() {
    const overlay = document.getElementById('uiv-topic-simulator-overlay');
    if (!overlay) return;
    if (overlay.topicController && typeof overlay.topicController.destroy === 'function') overlay.topicController.destroy();
    overlay.remove();
}

async function archiveImportedTopicSnapshot(snapshot, onProgress = () => {}) {
    if (!window.API || typeof window.API.post !== 'function') throw new Error('服务器 API 不可用');
    if (!window.EncryptedChunkUpload) throw new Error(topicUploadText('加密上传组件未加载，请刷新页面后重试', 'Encrypted upload component is unavailable; refresh and retry'));
    const result = await window.EncryptedChunkUpload.upload({ snapshot }, {
        endpoint: '/api/topic-snapshots', chunkAboveBytes: 800000, onProgress
    });
    showToast(result.message || '专题快照已保存到服务器');
    return result;
}

function topicUploadText(zh, en) {
    return document.documentElement.lang.toLowerCase().startsWith('en') ? en : zh;
}

function openTopicFloatingSimulator(origin) {
    const config = getTopicSimulatorConfig(origin);
    if (!config || !config.api || typeof config.api.installForSimulation !== 'function') {
        showToast('❌ 当前站点没有可用的专题模拟器，请刷新页面后重试。', 'error');
        return;
    }
    closeSiteConsoleScriptPicker(); closeTopicFloatingSimulator();
    const overlay = document.createElement('div'); overlay.id = 'uiv-topic-simulator-overlay'; overlay.className = 'uiv-topic-simulator-overlay';
    overlay.innerHTML = `
        <div class="uiv-topic-simulator-dialog" role="dialog" aria-modal="true" aria-labelledby="uiv-topic-simulator-title">
            <div class="uiv-topic-simulator-header">
                <div><h3 id="uiv-topic-simulator-title">${escapeUivHtml(config.name)} · 专题模拟浮窗</h3><p>离线模拟模式不会请求正式站点。导入后会将完整 JSON 归档到当前租户服务器。</p><a class="uiv-topic-analysis-link" href="/topic-analysis">打开专题分析 ↗</a></div>
                <button type="button" class="uiv-topic-simulator-close" aria-label="关闭">×</button>
            </div>
            <div class="uiv-topic-simulator-root">
                <div class="uiv-topic-simulator-float-head"><div><strong>${escapeUivHtml(config.name)} 浮窗</strong><small>JSON 离线回顾模拟器</small></div><div class="head-actions"></div></div>
                <div class="body">
                    <div class="notice">模拟浮窗已就绪，请进入专题并导入 JSON。</div><div class="status"></div><div class="actions"></div><div class="results"></div>
                </div>
            </div>
            <div class="uiv-topic-upload-progress" hidden>
                <div class="uiv-topic-upload-status" role="status" aria-live="polite"></div>
                <progress max="100" value="0" aria-label="上传进度 / Upload progress"></progress>
                <div class="uiv-topic-upload-log"></div>
            </div>
        </div>`;
    overlay.addEventListener('click', event => { if (event.target === overlay || event.target.closest('.uiv-topic-simulator-close')) closeTopicFloatingSimulator(); });
    overlay.addEventListener('keydown', event => { if (event.key === 'Escape') closeTopicFloatingSimulator(); });
    document.body.appendChild(overlay);
    const root = overlay.querySelector('.uiv-topic-simulator-root');
    const uploadPanel = overlay.querySelector('.uiv-topic-upload-progress');
    const uploadBar = uploadPanel.querySelector('progress');
    const uploadStatus = uploadPanel.querySelector('.uiv-topic-upload-status');
    const uploadLog = uploadPanel.querySelector('.uiv-topic-upload-log');
    let uploading = false;
    const uploadLogs = [];
    const onUploadProgress = ({ percent, message }) => {
        uploadPanel.hidden = false;
        if (Number.isFinite(percent)) uploadBar.value = percent;
        uploadStatus.textContent = `${Math.round(uploadBar.value)}% · ${message}`;
        uploadLogs.push(`[${new Date().toLocaleTimeString()}] ${message}`);
        if (uploadLogs.length > 500) uploadLogs.shift();
        uploadLog.textContent = uploadLogs.join('\n');
        uploadLog.scrollTop = uploadLog.scrollHeight;
    };
    try {
        overlay.topicController = config.api.installForSimulation(root, {
            isCaptureActive: () => false,
            onSnapshotImported: async snapshot => {
                if (uploading) throw new Error(topicUploadText('已有专题正在归档，请等待完成后再导入', 'A topic is being archived; wait before importing another'));
                uploading = true;
                uploadLogs.length = 0;
                uploadBar.value = 0;
                try { return await archiveImportedTopicSnapshot(snapshot, onUploadProgress); }
                catch (error) {
                    onUploadProgress({ message: error.status === 403
                        ? topicUploadText('服务器拒绝归档（403），请核查管理员权限或网关规则；该状态码不能单独证明文件过大。', 'Archive rejected (403). Check admin permissions or gateway rules; this status alone does not establish a file-size limit.')
                        : topicUploadText(`归档失败：${error.message}`, `Archive failed: ${error.message}`) });
                    throw error;
                } finally { uploading = false; }
            }
        });
        if (!overlay.topicController) throw new Error('专题运行时未能初始化');
        installFloatingCaptureTheme(root);
        const launcher = root.querySelector(config.launcher); if (launcher) launcher.click();
        const importButton = root.querySelector('.nc-json-import, .df-json-import'); if (importButton) importButton.focus();
    } catch (error) {
        closeTopicFloatingSimulator(); showToast(`❌ 打开专题模拟器失败：${error.message}`, 'error');
    }
}

function getFloatingSlaRuleDefaults() {
    const standardRule = (id, name, values, fields, type, offsetDays, prefix, warningDays, warningColor) => ({
        id, enabled: true, name, badgePrefix: prefix,
        match: { operator: 'equals', values, caseSensitive: false },
        deadline: { type, fields, offsetDays },
        alertLevels: [
            { id: `${id}-danger`, enabled: true, name: '紧急', maxDays: 10, severity: 'danger', badgeSuffix: '紧急', color: '#d32f2f' },
            { id: `${id}-warning`, enabled: true, name: '提醒', maxDays: warningDays, severity: 'warning', badgeSuffix: '提醒', color: warningColor }
        ]
    });
    return {
        risk: {
            version: 1,
            statusFields: ['风险状态', 'risk_status'],
            rules: [
                { id: 'risk-confirming', enabled: true, name: 'Risk Confirming', badgePrefix: 'Confirm', match: { operator: 'equals', values: ['Risk Confirming'], caseSensitive: false }, deadline: { type: 'field_plus_days', fields: ['创单时间', 'create_time_new', 'create_time'], offsetDays: 30 } },
                { id: 'risk-open', enabled: true, name: 'Risk Open', badgePrefix: 'Open', match: { operator: 'equals', values: ['Risk Open'], caseSensitive: false }, deadline: { type: 'date_field', fields: ['ticket_close_due_date', '期望关闭时间', 'due_time'], offsetDays: 0 } },
                { id: 'risk-suspended', enabled: true, name: 'Risk Suspended', badgePrefix: 'Suspend', match: { operator: 'equals', values: ['Risk Suspended'], caseSensitive: false }, deadline: { type: 'date_field', fields: ['ticket_close_due_date', '期望关闭时间', 'due_time', '期望关闭时间-挂起', 'suspend_due_date'], offsetDays: 0 } },
                { id: 'complete-reviewing', enabled: true, name: 'Complete Reviewing', badgePrefix: 'Review', match: { operator: 'equals', values: ['Complete Reviewing'], caseSensitive: false }, deadline: { type: 'date_field', fields: ['ticket_close_due_date', '期望关闭时间', 'due_time'], offsetDays: 0 } }
            ],
            alertLevels: [
                { id: 'danger', enabled: true, name: '红色紧急', maxDays: 10, severity: 'danger', badgeSuffix: '紧急', color: '#d32f2f' },
                { id: 'warning', enabled: true, name: '紫色提醒', maxDays: 29, severity: 'warning', badgeSuffix: '提醒', color: '#673ab7' }
            ]
        },
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
        },
        sr: {
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
            thresholds: { criticalDangerConsume: 85, criticalDangerHours: 12, criticalWarningConsume: 70, criticalWarningHours: 48, normalDangerConsume: 95, normalWarningConsume: 80 },
            alerts: {
                overdue: { enabled: true, label: 'SR超期', severity: 'danger', color: '#d32f2f' },
                criticalDanger: { enabled: true, label: 'Critical高危', severity: 'danger', color: '#d32f2f' },
                criticalWarning: { enabled: true, label: 'Critical预警', severity: 'warning', color: '#7b1fa2' },
                normalDanger: { enabled: true, label: 'SR高危', severity: 'danger', color: '#d32f2f' },
                normalWarning: { enabled: true, label: 'SR预警', severity: 'warning', color: '#7b1fa2' },
                pending: { enabled: true, label: '挂起忽略', severity: 'none', color: '#00897b' },
                closed: { enabled: true, label: '已关单', severity: 'none', color: '#00897b' },
                suspendedGood: { enabled: true, label: '挂起后未超期', severity: 'none', color: '#0288d1' },
                suspendedOverdue: { enabled: true, label: '挂起后超期', severity: 'danger', color: '#d32f2f' },
                historicalOverdue: { enabled: true, label: '历史超期', severity: 'danger', color: '#d32f2f' }
            }
        }
    };
}

async function loadFloatingSlaRuleBundle() {
    const builtinKeys = {
        risk: 'sla_builtin_rule_risk_v1',
        rectification: 'sla_builtin_rule_rectification_v1',
        special: 'sla_builtin_rule_special_v1',
        sr: 'sla_builtin_rule_sr_v1',
        vulnerability: 'sla_builtin_rule_vulnerability_v1'
    };
    try {
        const [configData, groups] = await Promise.all([
            API.get('/api/sla/config'),
            API.get('/api/sla/groups').catch(() => [])
        ]);
        const prefs = configData && configData.prefs && typeof configData.prefs === 'object'
            ? configData.prefs
            : {};
        const defaults = getFloatingSlaRuleDefaults();
        const builtin = {};
        Object.entries(builtinKeys).forEach(([mode, key]) => {
            const value = prefs[key];
            const saved = value && value.prefs && typeof value.prefs === 'object' ? value.prefs : value;
            builtin[mode] = saved && typeof saved === 'object' && Object.keys(saved).length ? saved : defaults[mode];
        });
        const metricSchemas = Object.entries(prefs)
            .filter(([, value]) => value && value._sourceMeta)
            .map(([key, value]) => ({
                key,
                sourceMeta: value._sourceMeta || null,
                customMetrics: Array.isArray(value.customMetrics) ? value.customMetrics : []
            }));
        return {
            schema: 'uivf12-sla-rule-bundle-v1',
            exportedAt: configData.exportDate || new Date().toISOString(),
            builtin,
            targets: configData.targets && typeof configData.targets === 'object' && !Array.isArray(configData.targets)
                ? configData.targets
                : {},
            groups: Array.isArray(groups) ? groups : [],
            metricSchemas
        };
    } catch (error) {
        console.warn('[UIVF12] SLA 规则快照读取失败，浮窗仍可抓取数据，但不会执行规则判断。', error);
        return {
            schema: 'uivf12-sla-rule-bundle-v1',
            exportedAt: new Date().toISOString(),
            builtin: getFloatingSlaRuleDefaults(),
            targets: {},
            groups: [],
            metricSchemas: [],
            unavailable: true
        };
    }
}

function normalizeFloatingSourceName(value) {
    return String(value || '')
        .replace(/^.*[\\/]/, '')
        .replace(/\.csv$/i, '')
        .replace(/\s*\(\d+\)$/i, '')
        .replace(/_?\d{4}年\d{1,2}月(?:\d{1,2}日)?$/i, '')
        .trim()
        .toLowerCase();
}

function scriptMatchesFloatingSource(script, sourceMeta) {
    if (!script || !sourceMeta) return false;
    const haystack = normalizeFloatingSourceName(`${script.name || ''} ${script.consoleCode || ''}`);
    const candidates = []
        .concat(sourceMeta.sourceFiles || [])
        .concat([sourceMeta.baseName, String(sourceMeta.matchedPrefix || '').replace(/\*+$/, '')])
        .map(normalizeFloatingSourceName)
        .filter(Boolean);
    return candidates.some(candidate => haystack.includes(candidate));
}

function expandFloatingMetricDependencies(selectedScripts, allScripts, ruleBundle, origin) {
    const schemas = Array.isArray(ruleBundle && ruleBundle.metricSchemas) ? ruleBundle.metricSchemas : [];
    const bySecId = new Map(schemas
        .filter(schema => schema && schema.sourceMeta && schema.sourceMeta.secId)
        .map(schema => [schema.sourceMeta.secId, schema]));
    const expanded = [...selectedScripts];
    const selectedIds = new Set(expanded.map(script => script.id || script.name));
    const added = [];
    const queue = schemas.filter(schema =>
        schema && schema.sourceMeta && expanded.some(script => scriptMatchesFloatingSource(script, schema.sourceMeta))
    );
    const visited = new Set();
    while (queue.length) {
        const schema = queue.shift();
        const secId = schema && schema.sourceMeta && schema.sourceMeta.secId;
        if (!secId || visited.has(secId)) continue;
        visited.add(secId);
        const dependencyIds = new Set();
        (schema.customMetrics || []).forEach(metric => {
            if (metric.sourceSecId && metric.sourceSecId !== secId) dependencyIds.add(metric.sourceSecId);
            (metric.subMetrics || []).forEach(subMetric => {
                if (subMetric.sourceSecId && subMetric.sourceSecId !== secId) dependencyIds.add(subMetric.sourceSecId);
            });
        });
        dependencyIds.forEach(dependencyId => {
            const dependencySchema = bySecId.get(dependencyId);
            if (!dependencySchema) return;
            const matchingScripts = (allScripts || []).filter(script => {
                let scriptOrigin = '';
                try { scriptOrigin = new URL(resolveUivOpenUrl(script, resolveUivScriptUrl(script)) || resolveUivScriptUrl(script) || '').origin; } catch (e) {}
                return scriptOrigin === origin && scriptMatchesFloatingSource(script, dependencySchema.sourceMeta);
            });
            matchingScripts.forEach(script => {
                const identity = script.id || script.name;
                if (selectedIds.has(identity)) return;
                selectedIds.add(identity);
                expanded.push(script);
                added.push(script);
            });
            queue.push(dependencySchema);
        });
    }
    return { scripts: expanded, added };
}

async function copySiteConsoleScripts(origin) {
    try {
        const { scripts = [] } = await API.get('/api/uiv/scripts');
        const ruleBundle = await loadFloatingSlaRuleBundle();
        const scope = applyUivBatchCategoryFilter(scripts);
        const grouped = groupConsoleScriptsBySite(scope.scripts);
        const site = grouped.sites.find(item => item.origin === origin);
        if (!site || !site.scripts.length) throw new Error(UIVT('uiv.siteScript.noSite', { site: origin }));
        const expanded = expandFloatingMetricDependencies(site.scripts, scripts, ruleBundle, site.origin);
        buildAndCopyMasterScript(expanded.scripts, `${site.name}-浮窗工具预备版`, {
            floatingLauncher: true,
            siteName: site.name,
            expectedOrigin: site.origin,
            ruleBundle
        });
        closeSiteConsoleScriptPicker();
        const dependencyText = expanded.added.length ? UIVT('uiv.siteScript.depText', { count: expanded.added.length }) : '';
        showToast(UIVT('uiv.siteScript.copied', { name: site.name, count: expanded.scripts.length, dep: dependencyText }), 'success');
    } catch (error) {
        showToast(UIVT('uiv.siteScript.copyFail', { error: error.message }), 'error');
    }
}

async function openSiteConsoleScriptPicker() {
    try {
        const { scripts = [] } = await API.get('/api/uiv/scripts');
        const scope = applyUivBatchCategoryFilter(scripts);
        const grouped = groupConsoleScriptsBySite(scope.scripts);
        closeSiteConsoleScriptPicker();

        const overlay = document.createElement('div');
        overlay.id = 'uiv-site-script-overlay';
        overlay.className = 'uiv-site-script-overlay';
        overlay.setAttribute('role', 'presentation');
        const siteRows = grouped.sites.map(site => {
            const simulator = getTopicSimulatorConfig(site.origin);
            return `
            <div class="uiv-site-script-item">
                <div style="min-width:0;">
                    <div class="uiv-site-script-name">${escapeUivHtml(site.name)}</div>
                    <div class="uiv-site-script-origin" title="${escapeUivHtml(site.origin)}">${escapeUivHtml(site.origin)}</div>
                    <div class="uiv-site-script-count">${UIVT('uiv.siteScript.scriptCount', { count: site.scripts.length })}</div>
                </div>
                <div class="uiv-site-script-buttons">${simulator ? `<button type="button" class="uiv-site-script-simulate" data-site-origin="${escapeUivHtml(site.origin)}">${UIVT('uiv.siteScript.simulate')}</button>` : ''}<button type="button" class="uiv-site-script-copy" data-site-origin="${escapeUivHtml(site.origin)}">${UIVT('uiv.siteScript.copy')}</button></div>
            </div>
        `; }).join('');
        const unresolvedNote = grouped.unresolved.length
            ? `<div class="uiv-site-script-notice">${UIVT('uiv.siteScript.unresolved', { count: grouped.unresolved.length })}</div>`
            : '';
        overlay.innerHTML = `
            <div class="uiv-site-script-dialog" role="dialog" aria-modal="true" aria-labelledby="uiv-site-script-title">
                <div class="uiv-site-script-header">
                    <div>
                        <h3 id="uiv-site-script-title">${UIVT('uiv.siteScript.title')}</h3>
                        <p>${UIVT('uiv.siteScript.subtitle')}</p>
                    </div>
                    <button type="button" class="uiv-site-script-close" aria-label="${UIVT('uiv.siteScript.close')}">×</button>
                </div>
                <div class="uiv-site-script-notice">${UIVT('uiv.siteScript.notice')}</div>
                ${unresolvedNote}
                <div class="uiv-site-script-list">
                    ${siteRows || `<div class="uiv-site-script-empty">${UIVT('uiv.siteScript.empty')}</div>`}
                </div>
            </div>
        `;
        overlay.addEventListener('click', event => {
            if (event.target === overlay || event.target.closest('.uiv-site-script-close')) {
                closeSiteConsoleScriptPicker();
                return;
            }
            const simulateButton = event.target.closest('.uiv-site-script-simulate');
            if (simulateButton) { openTopicFloatingSimulator(simulateButton.dataset.siteOrigin || ''); return; }
            const copyButton = event.target.closest('.uiv-site-script-copy');
            if (copyButton) copySiteConsoleScripts(copyButton.dataset.siteOrigin || '');
        });
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeSiteConsoleScriptPicker();
        });
        document.body.appendChild(overlay);
        overlay.style.display = 'flex';
        const firstButton = overlay.querySelector('.uiv-site-script-copy, .uiv-site-script-close');
        if (firstButton) firstButton.focus();
    } catch (error) {
        showToast(UIVT('uiv.siteScript.readFail', { error: error.message }), 'error');
    }
}

function buildLoginProbeScript(rawUrl, loginProbeConfig) {
    const custom = loginProbeConfig && typeof loginProbeConfig === 'object' ? loginProbeConfig : null;
    if (custom && custom.strategy === 'autoProbe' && custom.header) {
        return `return (function () {
            const header = ${JSON.stringify(String(custom.header))};
            const lower = header.toLowerCase();
            const kind = /csrf|xsrf|anti[-_]?forgery/.test(lower) ? "csrf"
                : (lower === "authorization" || lower === "proxy-authorization" ? "authorization"
                    : (/api[-_]?key/.test(lower) ? "apiKey" : "token"));
            const normalize = value => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
            const matches = value => {
                const key = normalize(value);
                if (kind === "csrf") return /csrf|xsrf|antiforgery|requestverification/.test(key);
                if (kind === "authorization") return /token|authorization|jwt|bearer/.test(key);
                if (kind === "apiKey") return /apikey/.test(key);
                return /token|secret/.test(key);
            };
            let source = "";
            try {
                const cookieParts = String(document.cookie || "").split(";");
                if (cookieParts.some(part => matches(part.split("=")[0]) && String(part.split("=").slice(1).join("=") || "").length >= 4)) source = "cookie";
            } catch (e) {}
            const probeStorage = (storage, name) => {
                try {
                    for (let index = 0; index < Math.min(storage.length, 240); index++) {
                        const key = storage.key(index) || "";
                        const value = storage.getItem(key) || "";
                        if ((matches(key) && value.length >= 4)
                            || (value.charAt(0) === "{" && new RegExp('"[^"}]*(?:csrf|xsrf|token|apiKey)[^"}]*"', "i").test(value))) return name;
                    }
                } catch (e) {}
                return "";
            };
            if (!source) source = probeStorage(localStorage, "localStorage");
            if (!source) source = probeStorage(sessionStorage, "sessionStorage");
            if (!source) {
                try {
                    source = Array.from(document.querySelectorAll("meta[name],input[name],input[id]"))
                        .some(node => matches(node.getAttribute("name") || node.getAttribute("id"))) ? "document" : "";
                } catch (e) {}
            }
            return JSON.stringify({
                ok: Boolean(source),
                reason: source ? "ok" : "auto_auth_source_missing",
                strategy: "autoProbe",
                header,
                source,
                host: location.host,
                href: location.href
            });
        })();`;
    }
    if (custom && (custom.strategy === 'localStorage' || custom.strategy === 'sessionStorage') && custom.sourceKey) {
        return `return (function () {
            const storage = ${custom.strategy === 'localStorage' ? 'localStorage' : 'sessionStorage'};
            const key = ${JSON.stringify(String(custom.sourceKey))};
            const value = storage.getItem(key) || "";
            return JSON.stringify({
                ok: Boolean(value),
                reason: value ? "ok" : "adapter_auth_missing",
                strategy: ${JSON.stringify(custom.strategy)},
                sourceKey: key,
                valueLen: value.length,
                host: location.host,
                href: location.href
            });
        })();`;
    }
    if (custom && custom.strategy === 'cookieHeader' && custom.sourceKey) {
        return `return (function () {
            const name = ${JSON.stringify(String(custom.sourceKey))};
            const escaped = name.replace(/[.*+?^\${}()|[\]\\]/g, "\\\\$&");
            const match = document.cookie.match(new RegExp("(?:^|;\\s*)" + escaped + "=([^;]*)"));
            return JSON.stringify({
                ok: Boolean(match && match[1]),
                reason: match && match[1] ? "ok" : "cookie_header_source_missing",
                strategy: "cookieHeader",
                sourceKey: name,
                host: location.host,
                href: location.href
            });
        })();`;
    }
    if (custom && custom.strategy === 'cookie') {
        return `return JSON.stringify({ ok: String(document.cookie || "").length > 0, reason: document.cookie ? "ok" : "cookie_missing", cookieLen: String(document.cookie || "").length, host: location.host, href: location.href });`;
    }
    if (custom && custom.strategy === 'none') {
        return `return JSON.stringify({ ok: true, reason: "adapter_no_auth", host: location.host, href: location.href });`;
    }
    const lowerUrl = String(rawUrl || '').toLowerCase();
    if (lowerUrl.includes('datafab')) {
        return `return (function () {
            const cookie = String(document.cookie || "");
            const ok = cookie.indexOf("XSRF-TOKEN=") !== -1 || cookie.indexOf("NETLIVE-XSRF-TOKEN=") !== -1;
            return JSON.stringify({
                ok,
                reason: ok ? "ok" : "xsrf_cookie_missing",
                cookieLen: cookie.length,
                host: location.host,
                href: location.href
            });
        })();`;
    }
    if (lowerUrl.includes('netcare')) {
        return `return (function () {
            const cfg = localStorage.getItem("globalConfig") || "";
            const cookie = String(document.cookie || "");
            let token = "";
            const match = cfg.match(/[A-Fa-f0-9]{64}/);
            if (match) token = match[0];
            if (!token) {
                try {
                    const parsed = JSON.parse(cfg || "{}");
                    const config = Array.isArray(parsed) ? (parsed[0] || {}) : parsed;
                    token = config.csrfToken || (config.configData && config.configData.csrfToken) || "";
                } catch (e) {}
            }
            const hasToken = String(token || "").length >= 16;
            const hasCookie = cookie.length > 20;
            return JSON.stringify({
                ok: hasToken && hasCookie,
                reason: hasToken && hasCookie ? "ok" : (!hasToken ? "csrf_missing" : "cookie_missing"),
                hasToken,
                tokenLen: token ? String(token).length : 0,
                globalConfigLen: cfg.length,
                cookieLen: cookie.length,
                host: location.host,
                href: location.href
            });
        })();`;
    }
    return `return (function () {
        const cookie = String(document.cookie || "");
        const ok = Boolean(cookie || localStorage.length > 0);
        return JSON.stringify({
            ok,
            reason: ok ? "ok" : "no_cookie_or_localstorage",
            cookieLen: cookie.length,
            localStorageLen: localStorage.length,
            host: location.host,
            href: location.href
        });
    })();`;
}

function buildLoginProbeStatusScript(loginVar, siteUrl) {
    return `return (function () {
        const raw = ${'${' + loginVar + '}'};
        let parsed = {};
        try {
            parsed = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
        } catch (e) {
            parsed = { ok: raw === 'true', reason: 'parse_failed', raw: String(raw || '') };
        }
        const ok = parsed.ok === true || parsed.ok === 'true' || raw === 'true';
        const reason = parsed.reason || (ok ? 'ok' : 'unknown');
        try {
            const bag = window.name ? JSON.parse(window.name) : {};
            const logs = Array.isArray(bag.uivf12LoginProbeLogs) ? bag.uivf12LoginProbeLogs : [];
            logs.push({ at: new Date().toISOString(), ok, reason, site: ${JSON.stringify(siteUrl || '')}, detail: parsed });
            bag.uivf12LoginProbeLogs = logs.slice(-80);
            window.name = JSON.stringify(bag);
        } catch (e) {}
        return ok ? 'true' : 'false';
    })();`;
}

function buildAppendPanelLogScript(loginVar, siteUrl) {
    return `return (function () {
        const raw = ${'${' + loginVar + '}'} || '';
        let parsed = {};
        try {
            parsed = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
        } catch (e) {
            parsed = { ok: raw === 'true', reason: 'parse_failed', raw: String(raw || '') };
        }
        const ok = parsed.ok === true || parsed.ok === 'true' || raw === 'true';
        const reason = parsed.reason || (ok ? 'ok' : 'unknown');
        const msg = '登录探测 ${String(siteUrl || '').replace(/'/g, "\\'")} -> ' + (ok ? 'OK' : 'WAIT') +
            ' · reason=' + reason +
            ' · tokenLen=' + (parsed.tokenLen || 0) +
            ' · globalConfigLen=' + (parsed.globalConfigLen || 0) +
            ' · cookieLen=' + (parsed.cookieLen || 0) +
            ' · host=' + (parsed.host || location.host);
        const target = document.getElementById('uivf12-batch-log-scroll');
        if (target) {
            const line = document.createElement('div');
            line.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#fde68a;';
            line.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false }) + ' ' + msg;
            target.appendChild(line);
            while (target.children.length > 100) target.removeChild(target.firstChild);
            target.scrollTop = target.scrollHeight;
        }
        return msg;
    })();`;
}

function buildNetcareGlobalConfigCompatScript() {
    return `return (function () {
        try {
            const raw = localStorage.getItem('globalConfig') || '';
            const parsed = JSON.parse(raw || '{}');
            if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === 'object') {
                localStorage.setItem('globalConfig', JSON.stringify(parsed[0]));
                return 'globalConfig-array-normalized';
            }
            return 'globalConfig-ok';
        } catch (e) {
            return 'globalConfig-parse-skip:' + (e && e.message ? e.message : e);
        }
    })();`;
}

function groupUivScriptsByOpenUrl(scripts) {
    const groups = [];
    const groupMap = new Map();
    scripts.forEach(script => {
        if (!groupMap.has(script.openUrl)) {
            const group = {
                openUrl: script.openUrl,
                loginProbe: buildLoginProbeScript(script.url, script.loginProbeConfig),
                scripts: []
            };
            groupMap.set(script.openUrl, group);
            groups.push(group);
        }
        groupMap.get(script.openUrl).scripts.push(script);
    });
    return groups;
}

function sampleUivScriptsPerSite(scripts, perSite = 2) {
    const prepared = scripts
        .map((script, index) => {
            const resolvedUrl = resolveUivScriptUrl(script);
            return {
                script,
                index,
                openUrl: resolveUivOpenUrl(script, resolvedUrl)
            };
        })
        .filter(item => item.openUrl && (item.script.code || item.script.consoleCode));
    const map = new Map();
    prepared.forEach(item => {
        if (!map.has(item.openUrl)) map.set(item.openUrl, []);
        map.get(item.openUrl).push(item);
    });
    const sampled = [];
    map.forEach(items => {
        const pool = [...items];
        for (let i = 0; i < perSite && pool.length; i++) {
            const pickIndex = Math.floor(Math.random() * pool.length);
            sampled.push(pool.splice(pickIndex, 1)[0].script);
        }
    });
    return sampled;
}

function buildUivBatchControlResetScript() {
    return `return (function () {
        try {
            const bag = window.name ? JSON.parse(window.name) : {};
            bag.uivf12BatchControl = {};
            window.name = JSON.stringify(bag);
        } catch (e) {
            window.name = JSON.stringify({ uivf12BatchControl: {} });
        }
        return 'ready';
    })();`;
}

function buildUivBatchControlReadScript() {
    return `return (function () {
        try {
            const bag = window.name ? JSON.parse(window.name) : {};
            return bag && bag.uivf12BatchControl && bag.uivf12BatchControl.stopRequested ? 'stop' : 'continue';
        } catch (e) {
            return 'continue';
        }
    })();`;
}

function buildUivControlledTaskScript(code, taskId, taskName) {
    const prefix = `return (async function () {
        const taskId = ${JSON.stringify(taskId)};
        const taskName = ${JSON.stringify(taskName)};
        const controlKey = 'uivf12BatchControl';
        function readControl() {
            try {
                const bag = window.name ? JSON.parse(window.name) : {};
                return bag && bag[controlKey] ? bag[controlKey] : {};
            } catch (e) {
                return {};
            }
        }
        const initialControl = readControl();
        if (initialControl.stopRequested) return '__UIVF12_STOPPED__';
        if (initialControl.skipTaskId === taskId) return '__UIVF12_SKIPPED__';

        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const previousFetch = window.fetch;
        const taskTimeouts = new Set();
        const taskIntervals = new Set();
        const taskSetTimeout = function (callback, delay) {
            const args = Array.prototype.slice.call(arguments, 2);
            const id = window.setTimeout(function () {
                taskTimeouts.delete(id);
                if (!controller || !controller.signal.aborted) callback.apply(window, args);
            }, delay);
            taskTimeouts.add(id);
            return id;
        };
        const taskClearTimeout = function (id) {
            taskTimeouts.delete(id);
            window.clearTimeout(id);
        };
        const taskSetInterval = function (callback, delay) {
            const args = Array.prototype.slice.call(arguments, 2);
            const id = window.setInterval(function () {
                if (!controller || !controller.signal.aborted) callback.apply(window, args);
            }, delay);
            taskIntervals.add(id);
            return id;
        };
        const taskClearInterval = function (id) {
            taskIntervals.delete(id);
            window.clearInterval(id);
        };
        const cancelTaskTimers = function () {
            taskTimeouts.forEach(function (id) { window.clearTimeout(id); });
            taskIntervals.forEach(function (id) { window.clearInterval(id); });
            taskTimeouts.clear();
            taskIntervals.clear();
        };
        if (controller) controller.signal.addEventListener('abort', cancelTaskTimers, { once: true });
        let taskFetch = null;
        if (controller && typeof previousFetch === 'function') {
            taskFetch = function (input, init) {
                const nextInit = Object.assign({}, init || {});
                const callerSignal = nextInit.signal;
                if (callerSignal && typeof callerSignal.addEventListener === 'function') {
                    if (callerSignal.aborted) controller.abort();
                    else callerSignal.addEventListener('abort', function () { controller.abort(); }, { once: true });
                }
                nextInit.signal = controller.signal;
                return previousFetch.call(this, input, nextInit);
            };
        }

        let pollTimer = null;
        const controlPromise = new Promise(function (resolve) {
            pollTimer = setInterval(function () {
                const control = readControl();
                if (!control.stopRequested && control.skipTaskId !== taskId) return;
                if (controller) {
                    try { controller.abort(); } catch (e) {}
                }
                resolve(control.stopRequested ? '__UIVF12_STOPPED__' : '__UIVF12_SKIPPED__');
            }, 250);
        });

        const taskPromise = (async function (setTimeout, clearTimeout, setInterval, clearInterval, fetch) {
`;
    const suffix = `
        }).call(window, taskSetTimeout, taskClearTimeout, taskSetInterval, taskClearInterval, taskFetch || previousFetch);
        try {
            return await Promise.race([Promise.resolve(taskPromise), controlPromise]);
        } finally {
            if (pollTimer) clearInterval(pollTimer);
            cancelTaskTimers();
            console.info('[UIVF12 Batch Control] task settled:', taskName);
        }
    })();`;
    return prefix + String(code || '') + suffix;
}

function buildUivProgressPanelScript(state) {
    return `(() => {
        const state = ${JSON.stringify(state)};
        const controlKey = 'uivf12BatchControl';
        function readWindowState() {
            try {
                const parsed = window.name ? JSON.parse(window.name) : {};
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch (e) {
                return { __uivf12OriginalWindowName: window.name || '' };
            }
        }
        function readControl() {
            const bag = readWindowState();
            return bag[controlKey] || {};
        }
        function writeControl(nextControl) {
            const bag = readWindowState();
            bag[controlKey] = Object.assign({}, bag[controlKey] || {}, nextControl);
            window.name = JSON.stringify(bag);
        }
        function appendControlLog(message) {
            const latest = readControl();
            const logs = Array.isArray(latest.logs) ? latest.logs.slice(-39) : [];
            logs.push(new Date().toLocaleTimeString('zh-CN', { hour12: false }) + ' ' + message);
            writeControl({ logs });
        }
        const control = readControl();
        if (control.closed) {
            ['uivf12-batch-progress-panel', 'uivf12-control-aura', 'uivf12-control-scanline', 'uivf12-control-hint'].forEach(function (id) {
                const node = document.getElementById(id);
                if (node) node.remove();
            });
            return 'panel-closed';
        }
        let auraStyle = document.getElementById('uivf12-control-aura-style');
        if (!auraStyle) {
            auraStyle = document.createElement('style');
            auraStyle.id = 'uivf12-control-aura-style';
            auraStyle.textContent = '@keyframes uivf12AuraPulse{0%,100%{opacity:.55;box-shadow:inset 0 0 28px rgba(34,211,238,.34),inset 0 0 78px rgba(59,130,246,.18)}50%{opacity:.95;box-shadow:inset 0 0 42px rgba(103,232,249,.55),inset 0 0 118px rgba(139,92,246,.24)}}@keyframes uivf12Scan{0%{transform:translateY(-120%)}100%{transform:translateY(120vh)}}';
            document.documentElement.appendChild(auraStyle);
        }
        let aura = document.getElementById('uivf12-control-aura');
        if (!aura) {
            aura = document.createElement('div');
            aura.id = 'uivf12-control-aura';
            document.documentElement.appendChild(aura);
        }
        aura.style.cssText = [
            'position:fixed',
            'inset:0',
            'z-index:2147483645',
            'pointer-events:none',
            'border:2px solid rgba(103,232,249,.44)',
            'box-shadow:inset 0 0 34px rgba(34,211,238,.42),inset 0 0 96px rgba(59,130,246,.2)',
            'animation:uivf12AuraPulse 2.4s ease-in-out infinite',
            'box-sizing:border-box'
        ].join(';');
        let scan = document.getElementById('uivf12-control-scanline');
        if (!scan) {
            scan = document.createElement('div');
            scan.id = 'uivf12-control-scanline';
            document.documentElement.appendChild(scan);
        }
        scan.style.cssText = [
            'position:fixed',
            'left:0',
            'right:0',
            'top:0',
            'height:90px',
            'z-index:2147483646',
            'pointer-events:none',
            'background:linear-gradient(180deg,rgba(103,232,249,0),rgba(103,232,249,.16),rgba(103,232,249,0))',
            'animation:uivf12Scan 4.8s linear infinite'
        ].join(';');
        let controlHint = document.getElementById('uivf12-control-hint');
        if (!controlHint) {
            controlHint = document.createElement('div');
            controlHint.id = 'uivf12-control-hint';
            document.documentElement.appendChild(controlHint);
        }
        controlHint.style.cssText = [
            'position:fixed',
            'left:18px',
            'bottom:18px',
            'z-index:2147483647',
            'pointer-events:none',
            'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
            'font-size:11px',
            'line-height:1.5',
            'color:#cffafe',
            'background:rgba(6,18,32,.78)',
            'border:1px solid rgba(103,232,249,.32)',
            'box-shadow:0 10px 32px rgba(8,47,73,.28)',
            'border-radius:10px',
            'padding:8px 10px',
            'backdrop-filter:blur(10px)'
        ].join(';');
        controlHint.innerHTML = 'UIVF12 CONTROL ACTIVE<br><span style="color:#93c5fd;">页面自动化接管中 · 右下角面板显示进度</span><br><span style="color:#fde68a;font-weight:800;">' + state.tenantWarning + '</span>';
        const pct = (done, total) => total ? Math.round((done / total) * 100) : 0;
        const generatedLogs = Array.isArray(state.logs) ? state.logs : [];
        const controlLogs = Array.isArray(control.logs) ? control.logs : [];
        const clampLogs = generatedLogs.concat(controlLogs).slice(-80);
        let panel = document.getElementById('uivf12-batch-progress-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'uivf12-batch-progress-panel';
            document.documentElement.appendChild(panel);
        }
        const positionStyles = control.x !== undefined && control.y !== undefined
            ? ['left:' + control.x + 'px', 'top:' + control.y + 'px']
            : ['right:18px', 'bottom:18px'];
        panel.style.cssText = [
            'position:fixed',
            positionStyles.join(';'),
            'width:' + Math.max(320, Math.min(720, control.width || 390)) + 'px',
            control.height ? 'height:' + Math.max(260, Math.min(760, control.height)) + 'px' : '',
            'min-width:320px',
            'min-height:260px',
            'max-width:calc(100vw - 36px)',
            'max-height:calc(100vh - 36px)',
            'z-index:2147483647',
            'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif',
            'color:#e5f7ff',
            'background:linear-gradient(145deg,rgba(6,18,32,.96),rgba(8,47,73,.94))',
            'border:1px solid rgba(56,189,248,.38)',
            'box-shadow:0 18px 60px rgba(8,47,73,.38), inset 0 0 0 1px rgba(255,255,255,.05)',
            'border-radius:14px',
            'padding:14px',
            'backdrop-filter:blur(12px)',
            'box-sizing:border-box',
            'resize:both',
            'overflow:hidden'
        ].join(';');
        const bar = (done, total, accent) => {
            const value = pct(done, total);
            return '<div style="height:8px;background:rgba(148,163,184,.18);border-radius:999px;overflow:hidden;border:1px solid rgba(148,163,184,.16);">' +
                '<div style="height:100%;width:' + value + '%;background:' + accent + ';box-shadow:0 0 18px rgba(34,211,238,.42);transition:width .35s ease;"></div>' +
            '</div>';
        };
        const siteRows = state.sites.map(site => {
            const active = site.status === 'running';
            const done = site.status === 'done';
            const statusText = done ? '完成' : (active ? '执行中' : (site.status === 'waiting' ? '待登录' : '等待'));
            const color = done ? '#34d399' : (active ? '#38bdf8' : (site.status === 'waiting' ? '#fbbf24' : '#94a3b8'));
            return '<div style="padding:10px 0;border-top:1px solid rgba(148,163,184,.14);">' +
                '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:7px;">' +
                    '<div style="min-width:0;font-size:12px;font-weight:700;color:#e0f2fe;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + site.label + '</div>' +
                    '<div style="font-size:11px;color:' + color + ';white-space:nowrap;">' + statusText + ' · ' + site.done + '/' + site.total + '</div>' +
                '</div>' +
                bar(site.done, site.total, done ? 'linear-gradient(90deg,#22c55e,#86efac)' : 'linear-gradient(90deg,#0ea5e9,#22d3ee)') +
            '</div>';
        }).join('');
        const logRows = clampLogs.map(log => '<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + log + '</div>').join('');
        panel.innerHTML =
            '<div id="uivf12-batch-panel-handle" style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;cursor:move;user-select:none;">' +
                '<div>' +
                    '<div style="font-size:14px;font-weight:800;letter-spacing:.2px;color:#f8fafc;">UIVF12 批量阵列控制台</div>' +
                    '<div style="font-size:10px;color:#93c5fd;margin-top:2px;">' + state.groupName + ' · 可拖动 / 可缩放</div>' +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:6px;">' +
                    '<div style="font-size:11px;color:#67e8f9;border:1px solid rgba(103,232,249,.28);border-radius:999px;padding:4px 8px;background:rgba(8,145,178,.14);">' + state.phase + '</div>' +
                    '<button id="uivf12-batch-close" type="button" title="关闭浮窗（任务继续运行）" style="width:26px;height:26px;border-radius:7px;border:1px solid rgba(148,163,184,.28);background:rgba(15,23,42,.72);color:#cbd5e1;cursor:pointer;font-size:17px;line-height:1;">×</button>' +
                '</div>' +
            '</div>' +
            '<div style="margin:0 0 11px;padding:9px 10px;border:1px solid rgba(251,191,36,.38);border-radius:9px;background:rgba(146,64,14,.2);color:#fef3c7;font-size:11px;font-weight:750;line-height:1.5;">' + state.tenantWarning + '</div>' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:8px;">' +
                '<div style="font-size:28px;line-height:1;font-weight:900;color:#ffffff;">' + pct(state.done, state.total) + '%</div>' +
                '<div style="font-size:12px;color:#bae6fd;">总进度 ' + state.done + '/' + state.total + '</div>' +
            '</div>' +
            bar(state.done, state.total, 'linear-gradient(90deg,#06b6d4,#3b82f6,#8b5cf6)') +
            '<div style="display:flex;gap:8px;margin-top:11px;">' +
                '<button id="uivf12-batch-skip" type="button" style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid rgba(251,191,36,.4);background:rgba(180,83,9,.2);color:#fde68a;font-weight:700;cursor:pointer;">跳过当前任务</button>' +
                '<button id="uivf12-batch-stop" type="button" style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid rgba(248,113,113,.42);background:rgba(153,27,27,.24);color:#fecaca;font-weight:700;cursor:pointer;">停止全部任务</button>' +
            '</div>' +
            '<div style="margin-top:10px;">' + siteRows + '</div>' +
            '<div style="margin-top:10px;border-top:1px solid rgba(148,163,184,.16);padding-top:9px;">' +
                '<div style="font-size:10px;color:#7dd3fc;text-transform:uppercase;letter-spacing:.12em;margin-bottom:5px;">Live Log</div>' +
                '<div id="uivf12-batch-log-scroll" style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;line-height:1.55;color:#cbd5e1;height:96px;overflow-y:auto;overflow-x:hidden;padding-right:4px;">' + logRows + '</div>' +
            '</div>';
        const appendLocalLog = function (message, color) {
            const target = panel.querySelector('#uivf12-batch-log-scroll');
            if (!target) return;
            const line = document.createElement('div');
            line.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:' + (color || '#cbd5e1') + ';';
            line.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false }) + ' ' + message;
            target.appendChild(line);
            target.scrollTop = target.scrollHeight;
        };
        const skipButton = panel.querySelector('#uivf12-batch-skip');
        if (skipButton) {
            const canSkip = Boolean(state.activeTaskId) && !control.stopRequested;
            skipButton.disabled = !canSkip;
            if (!canSkip) {
                skipButton.style.opacity = '.45';
                skipButton.style.cursor = 'not-allowed';
                skipButton.title = '当前没有正在执行的可跳过任务';
            }
            skipButton.onclick = function () {
                if (!state.activeTaskId) return;
                writeControl({ skipTaskId: state.activeTaskId, skipRequestedAt: Date.now() });
                appendControlLog('已请求跳过：' + (state.activeTaskName || '当前任务'));
                skipButton.disabled = true;
                skipButton.style.opacity = '.55';
                skipButton.textContent = '正在跳过…';
                appendLocalLog('已请求跳过：' + (state.activeTaskName || '当前任务'), '#fde68a');
            };
        }
        const stopButton = panel.querySelector('#uivf12-batch-stop');
        if (stopButton) {
            if (control.stopRequested) {
                stopButton.disabled = true;
                stopButton.textContent = '全部任务已停止';
                stopButton.style.opacity = '.6';
            }
            stopButton.onclick = function () {
                if (!window.confirm('确定停止全部批量任务？未执行的任务将不再运行。')) return;
                writeControl({ stopRequested: true, stoppedAt: Date.now() });
                appendControlLog('已请求停止全部任务');
                stopButton.disabled = true;
                stopButton.textContent = '正在停止全部任务…';
                stopButton.style.opacity = '.65';
                if (skipButton) skipButton.disabled = true;
                appendLocalLog('已请求停止全部任务', '#fecaca');
            };
        }
        const closeButton = panel.querySelector('#uivf12-batch-close');
        if (closeButton) {
            closeButton.onclick = function () {
                writeControl({ closed: true, closedAt: Date.now() });
                ['uivf12-batch-progress-panel', 'uivf12-control-aura', 'uivf12-control-scanline', 'uivf12-control-hint'].forEach(function (id) {
                    const node = document.getElementById(id);
                    if (node) node.remove();
                });
            };
        }
        const handle = panel.querySelector('#uivf12-batch-panel-handle');
        if (handle && !panel.__uivf12DragBound) {
            panel.__uivf12DragBound = true;
            const dragStart = function (event) {
                if (event.button !== 0) return;
                if (event.target && event.target.closest && event.target.closest('#uivf12-batch-log-scroll')) return;
                if (event.target && ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
                const rect = panel.getBoundingClientRect();
                const nearResizeCorner = event.clientX > rect.right - 24 && event.clientY > rect.bottom - 24;
                if (nearResizeCorner) return;
                const startX = event.clientX;
                const startY = event.clientY;
                const offsetX = startX - rect.left;
                const offsetY = startY - rect.top;
                function move(moveEvent) {
                    const maxX = window.innerWidth - Math.min(panel.offsetWidth, window.innerWidth);
                    const maxY = window.innerHeight - Math.min(panel.offsetHeight, window.innerHeight);
                    const x = Math.max(0, Math.min(maxX, moveEvent.clientX - offsetX));
                    const y = Math.max(0, Math.min(maxY, moveEvent.clientY - offsetY));
                    panel.style.left = x + 'px';
                    panel.style.top = y + 'px';
                    panel.style.right = 'auto';
                    panel.style.bottom = 'auto';
                    writeControl({ x, y, width: panel.offsetWidth, height: panel.offsetHeight });
                }
                function up() {
                    writeControl({ width: panel.offsetWidth, height: panel.offsetHeight });
                    window.removeEventListener('mousemove', move);
                    window.removeEventListener('mouseup', up);
                }
                window.addEventListener('mousemove', move);
                window.addEventListener('mouseup', up);
                event.preventDefault();
            };
            handle.addEventListener('mousedown', dragStart);
            panel.addEventListener('mousedown', dragStart);
            if (window.ResizeObserver) {
                panel.__uivf12ResizeObserver = new ResizeObserver(function () {
                    const rect = panel.getBoundingClientRect();
                    writeControl({ x: rect.left, y: rect.top, width: panel.offsetWidth, height: panel.offsetHeight });
                });
                panel.__uivf12ResizeObserver.observe(panel);
            }
        }
        panel.onmouseup = function () {
            const rect = panel.getBoundingClientRect();
            writeControl({ x: rect.left, y: rect.top, width: panel.offsetWidth, height: panel.offsetHeight });
        };
        const logScroll = panel.querySelector('#uivf12-batch-log-scroll');
        if (logScroll) logScroll.scrollTop = logScroll.scrollHeight;
        return 'panel-updated';
    })();`;
}

function buildUivCompletionDialogScript(summary) {
    return `(() => {
        const summary = ${JSON.stringify(summary)};
        function readWindowState() {
            try {
                const parsed = window.name ? JSON.parse(window.name) : {};
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch (e) {
                return {};
            }
        }
        const actualFiles = (readWindowState().uivf12Downloads || []).filter(Boolean);
        const importedFiles = (readWindowState().uivf12AutoImportDatasets || []).filter(Boolean);
        const failedImports = (readWindowState().uivf12AutoImportFailures || []).filter(Boolean);
        const noDownloadTasks = (readWindowState().uivf12NoDownloadTasks || []).filter(Boolean);
        const hasActualFiles = actualFiles.length > 0;
        const hasImportedFiles = importedFiles.length > 0;
        const hasFailedImports = failedImports.length > 0;
        const hasNoDownloadTasks = noDownloadTasks.length > 0;
        const importUrl = summary.autoImport && summary.autoImport.slaUrl ? summary.autoImport.slaUrl : '';
        function buildImportUrl(month) {
            if (!importUrl) return '';
            try {
                const url = new URL(importUrl, window.location.origin);
                const normalized = parseInt(month, 10);
                if (normalized >= 1 && normalized <= 12) url.searchParams.set('targetMonth', String(normalized));
                else url.searchParams.delete('targetMonth');
                return url.href;
            } catch (e) {
                return importUrl;
            }
        }
        const monthOptions = ['<option value="">SLA默认月份</option>'].concat(Array.from({ length: 12 }, (_, index) => {
            const month = index + 1;
            return '<option value="' + month + '">' + month + '月</option>';
        })).join('');
        const old = document.getElementById('uivf12-completion-dialog');
        if (old) old.remove();
        const overlay = document.createElement('div');
        overlay.id = 'uivf12-completion-dialog';
        overlay.style.cssText = [
            'position:fixed',
            'inset:0',
            'z-index:2147483647',
            'display:grid',
            'place-items:center',
            'background:rgba(2,6,23,.58)',
            'backdrop-filter:blur(8px)',
            'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif',
            'color:#e2e8f0',
            'padding:20px'
        ].join(';');
        const fileRows = actualFiles.map((name, index) =>
            '<div style="display:grid;grid-template-columns:46px minmax(0,1fr);gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid rgba(148,163,184,.14);font-size:13px;line-height:1.45;">' +
                '<span style="color:#67e8f9;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:800;">#' + String(index + 1).padStart(2, '0') + '</span>' +
                '<span style="word-break:break-all;white-space:normal;color:#f8fafc;font-weight:650;">' + String(name).replace(/[<>&]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[ch])) + '</span>' +
            '</div>'
        ).join('');
        const escapeHtml = value => String(value === undefined || value === null ? '' : value).replace(/[<>&]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[ch]));
        const failedRows = failedImports.map(item => {
            const detail = item && typeof item.detail === 'object' ? item.detail : {};
            const detailLines = [
                ['时间', item.at || ''],
                ['行数', detail.rowCount],
                ['字段数', detail.headerCount],
                ['桥接负载约', detail.approxBytes ? (detail.approxBytes + ' bytes') : ''],
                ['桥接错误', detail.bridgeError],
                ['Fetch 错误', detail.fetchError],
                ['完整信息', detail.message || detail.error || item.reason || '']
            ].filter(pair => pair[1] !== undefined && pair[1] !== null && String(pair[1]) !== '');
            const detailHtml = detailLines.map(pair =>
                '<div style="display:grid;grid-template-columns:82px minmax(0,1fr);gap:8px;padding:2px 0;">' +
                    '<span style="color:#fda4af;">' + escapeHtml(pair[0]) + '</span>' +
                    '<span style="color:#fecaca;word-break:break-all;">' + escapeHtml(pair[1]) + '</span>' +
                '</div>'
            ).join('');
            return '<details style="padding:8px 0;border-bottom:1px solid rgba(251,113,133,.14);font-size:12px;line-height:1.45;">' +
                '<summary style="cursor:pointer;color:#fecaca;font-weight:750;word-break:break-all;">' + escapeHtml(item.name || item) +
                    '<span style="margin-left:8px;color:#fda4af;font-weight:600;">' + escapeHtml(item.reason || '自动导入失败') + '</span>' +
                '</summary>' +
                '<div style="margin-top:6px;padding:8px;border-radius:8px;background:rgba(127,29,29,.16);font-size:11px;">' + detailHtml + '</div>' +
            '</details>';
        }).join('');
        const noDownloadRows = noDownloadTasks.map(item => {
            const fetchRows = Array.isArray(item.recentFetch) ? item.recentFetch : [];
            const fetchHtml = fetchRows.length
                ? '<div style="margin-top:6px;border-top:1px solid rgba(251,191,36,.18);padding-top:6px;">' +
                    '<div style="color:#fde68a;font-weight:800;margin-bottom:4px;">最近 Fetch 诊断</div>' +
                    fetchRows.map(fetchItem => {
                        const status = fetchItem.status !== undefined && fetchItem.status !== '' ? fetchItem.status : '-';
                        const ok = fetchItem.ok !== undefined && fetchItem.ok !== '' ? fetchItem.ok : '-';
                        const contentType = fetchItem.contentType || '-';
                        const err = fetchItem.error ? (' · ' + fetchItem.error) : '';
                        const duration = fetchItem.durationMs !== undefined && fetchItem.durationMs !== '' ? (' · ' + fetchItem.durationMs + 'ms') : '';
                        return '<div style="padding:4px 0;border-top:1px dashed rgba(251,191,36,.12);">' +
                            '<div style="color:#fef3c7;word-break:break-all;">' + escapeHtml(fetchItem.url || '-') + '</div>' +
                            '<div style="color:#fde68a;">status=' + escapeHtml(status) + ' · ok=' + escapeHtml(ok) + ' · type=' + escapeHtml(contentType) + duration + escapeHtml(err) + '</div>' +
                        '</div>';
                    }).join('') +
                '</div>'
                : '';
            const lines = [
                ['时间', item.at || ''],
                ['该脚本前后下载数', String(item.before || 0) + ' -> ' + String(item.after || 0)],
                ['该脚本前后导入数', String(item.beforeImports || 0) + ' -> ' + String(item.afterImports || 0)],
                ['脚本返回', item.result || ''],
                ['审计结论', item.auditResult || '']
            ].filter(pair => pair[1] !== undefined && pair[1] !== null && String(pair[1]) !== '');
            const detailHtml = lines.map(pair =>
                '<div style="display:grid;grid-template-columns:82px minmax(0,1fr);gap:8px;padding:2px 0;">' +
                    '<span style="color:#fde68a;">' + escapeHtml(pair[0]) + '</span>' +
                    '<span style="color:#fef3c7;word-break:break-all;">' + escapeHtml(pair[1]) + '</span>' +
                '</div>'
            ).join('') + fetchHtml;
            return '<details style="padding:8px 0;border-bottom:1px solid rgba(251,191,36,.14);font-size:12px;line-height:1.45;">' +
                '<summary style="cursor:pointer;color:#fde68a;font-weight:750;word-break:break-all;">' + escapeHtml(item.name || '未命名脚本') + '</summary>' +
                '<div style="margin-top:6px;padding:8px;border-radius:8px;background:rgba(146,64,14,.16);font-size:11px;">' + detailHtml + '</div>' +
            '</details>';
        }).join('');
        overlay.innerHTML =
            '<div style="width:min(720px,100%);max-height:calc(100vh - 40px);overflow:hidden;background:rgba(15,23,42,.96);border:1px solid rgba(56,189,248,.38);border-radius:16px;box-shadow:0 24px 90px rgba(0,0,0,.45);">' +
                '<div style="padding:20px 22px 14px;border-bottom:1px solid rgba(148,163,184,.16);display:flex;justify-content:space-between;gap:16px;align-items:flex-start;">' +
                    '<div>' +
                        '<div style="font-size:20px;font-weight:900;color:#f8fafc;">UIVF12 批量抓取完成</div>' +
                        '<div style="font-size:12px;color:#93c5fd;margin-top:4px;">' + summary.groupName + ' · ' + summary.finishedAt + '</div>' +
                    '</div>' +
                    '<button type="button" id="uivf12-completion-close" style="border:0;background:transparent;color:#94a3b8;font-size:24px;cursor:pointer;line-height:1;">×</button>' +
                '</div>' +
                '<div style="padding:18px 22px;">' +
                    '<div style="margin-bottom:14px;padding:11px 13px;border:1px solid rgba(251,191,36,.42);border-radius:10px;background:rgba(146,64,14,.2);color:#fef3c7;font-size:12px;font-weight:800;line-height:1.55;">' + summary.tenantWarning + '</div>' +
                    '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:14px;">' +
                        '<div style="border:1px solid rgba(103,232,249,.18);border-radius:10px;padding:10px;background:rgba(8,47,73,.28);"><div style="font-size:10px;color:#7dd3fc;text-transform:uppercase;">脚本任务</div><div style="font-size:22px;font-weight:900;">' + summary.taskCount + '</div></div>' +
                        '<div style="border:1px solid rgba(103,232,249,.18);border-radius:10px;padding:10px;background:rgba(8,47,73,.28);"><div style="font-size:10px;color:#7dd3fc;text-transform:uppercase;">实际文件</div><div style="font-size:22px;font-weight:900;">' + (hasActualFiles ? actualFiles.length : '未检测') + '</div></div>' +
                        '<div style="border:1px solid rgba(103,232,249,.18);border-radius:10px;padding:10px;background:rgba(8,47,73,.28);"><div style="font-size:10px;color:#7dd3fc;text-transform:uppercase;">自动导入</div><div style="font-size:22px;font-weight:900;">' + (hasImportedFiles ? importedFiles.length : '未暂存') + '</div></div>' +
                    '</div>' +
                    '<div style="font-size:12px;color:#cbd5e1;margin-bottom:10px;">文件会继续下载到浏览器默认下载目录；自动导入只上传浏览器端解析后的结构化 rows，不上传原始 CSV 文件。</div>' +
                    (importUrl && hasImportedFiles ? '<div id="uivf12-import-open-hint" style="margin-bottom:12px;padding:10px;border:1px solid rgba(34,197,94,.28);border-radius:10px;background:rgba(22,101,52,.16);font-size:12px;color:#bbf7d0;line-height:1.55;">' +
                        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                            '<span>即将在新标签页打开数据导入页面并执行智能分流合并，当前抓取结果页会保留。</span>' +
                            '<label style="display:inline-flex;align-items:center;gap:5px;color:#d1fae5;">目标月份<select id="uivf12-import-target-month" style="height:24px;border-radius:6px;border:1px solid rgba(103,232,249,.34);background:rgba(15,23,42,.78);color:#e0f2fe;font-size:12px;">' + monthOptions + '</select></label>' +
                            '<a id="uivf12-import-open-link" href="' + buildImportUrl('').replace(/"/g, '&quot;') + '" target="_blank" rel="noopener" style="color:#67e8f9;font-weight:800;">立即打开</a>' +
                        '</div>' +
                        '<div style="margin-top:4px;color:#fde68a;">如果浏览器拦截了自动打开新标签页，请点击上方“立即打开”。</div></div>' : '') +
                    (hasFailedImports ? '<div style="margin-bottom:12px;padding:10px 14px;border:1px solid rgba(251,113,133,.3);border-radius:10px;background:rgba(127,29,29,.18);"><div style="font-size:12px;color:#fecaca;font-weight:850;margin-bottom:6px;">以下文件下载成功，但自动导入失败</div>' + failedRows + '</div>' : '') +
                    (hasNoDownloadTasks ? '<div style="margin-bottom:12px;padding:10px 14px;border:1px solid rgba(251,191,36,.3);border-radius:10px;background:rgba(146,64,14,.16);"><div style="font-size:12px;color:#fde68a;font-weight:850;margin-bottom:6px;">以下脚本已执行，但未检测到下载文件</div>' + noDownloadRows + '</div>' : '') +
                    '<div style="max-height:320px;overflow:auto;border:1px solid rgba(148,163,184,.16);border-radius:10px;padding:4px 14px;background:rgba(2,6,23,.34);">' + (fileRows || '<div style="padding:14px;color:#94a3b8;font-size:13px;">未检测到本次下载文件名。若浏览器或扩展绕过页面下载事件，文件数量将不显示。</div>') + '</div>' +
                '</div>' +
            '</div>';
        overlay.querySelector('#uivf12-completion-close').onclick = () => overlay.remove();
        overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
        document.documentElement.appendChild(overlay);
        if (importUrl && hasImportedFiles) {
            const monthSelect = overlay.querySelector('#uivf12-import-target-month');
            const openLink = overlay.querySelector('#uivf12-import-open-link');
            const syncImportLink = function () {
                const nextUrl = buildImportUrl(monthSelect ? monthSelect.value : '');
                if (openLink && nextUrl) openLink.href = nextUrl;
                return nextUrl;
            };
            if (monthSelect) monthSelect.addEventListener('change', syncImportLink);
            syncImportLink();
            setTimeout(function () {
                const opened = window.open(syncImportLink(), '_blank', 'noopener');
                if (!opened) {
                    const hint = overlay.querySelector('#uivf12-import-open-hint');
                    if (hint) {
                        hint.style.borderColor = 'rgba(251,191,36,.42)';
                        hint.style.background = 'rgba(146,64,14,.18)';
                    }
                }
            }, 1800);
        }
        return 'completion-shown';
    })();`;
}

function buildUivDownloadRecorderScript(options = {}) {
    return `(() => {
        const reset = ${options.reset ? 'true' : 'false'};
        const autoImport = ${JSON.stringify(options.autoImport || null)};
        function readWindowState() {
            try {
                const parsed = window.name ? JSON.parse(window.name) : {};
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch (e) {
                return {};
            }
        }
        function writeWindowState(nextState) {
            window.name = JSON.stringify(nextState);
        }
        function recordDownloadName(name) {
            if (!name) return;
            const bag = readWindowState();
            const list = Array.isArray(bag.uivf12Downloads) ? bag.uivf12Downloads : [];
            list.push(String(name));
            bag.uivf12Downloads = list;
            writeWindowState(bag);
        }
        function recordAutoImportName(name) {
            if (!name) return;
            const bag = readWindowState();
            const list = Array.isArray(bag.uivf12AutoImportDatasets) ? bag.uivf12AutoImportDatasets : [];
            list.push(String(name));
            bag.uivf12AutoImportDatasets = list;
            writeWindowState(bag);
        }
        function recordAutoImportFailure(name, reason) {
            if (!name) return;
            const bag = readWindowState();
            const list = Array.isArray(bag.uivf12AutoImportFailures) ? bag.uivf12AutoImportFailures : [];
            const detail = reason && typeof reason === 'object' ? reason : { message: reason };
            const message = detail.message || detail.error || '自动导入失败';
            const signature = String(name) + '::' + String(message);
            if (list.some(item => item && item.signature === signature)) return;
            list.push({
                name: String(name),
                reason: String(message).slice(0, 260),
                signature,
                detail,
                at: new Date().toISOString()
            });
            bag.uivf12AutoImportFailures = list;
            writeWindowState(bag);
        }
        function rememberFetchDiagnostic(info) {
            try {
                const bag = readWindowState();
                const list = Array.isArray(bag.uivf12FetchDiagnostics) ? bag.uivf12FetchDiagnostics : [];
                list.push(Object.assign({ at: new Date().toISOString() }, info || {}));
                bag.uivf12FetchDiagnostics = list.slice(-40);
                writeWindowState(bag);
            } catch (e) {}
        }
        function hasRecentDirectCapture(name) {
            if (!name) return false;
            const captures = window.__uivf12RecentDirectCaptures || {};
            return Date.now() - (captures[String(name)] || 0) < 5000;
        }
        function markRecentDirectCapture(name) {
            if (!name) return;
            window.__uivf12RecentDirectCaptures = window.__uivf12RecentDirectCaptures || {};
            window.__uivf12RecentDirectCaptures[String(name)] = Date.now();
        }
        function parseCsv(text) {
            const table = parseCsvTable(text);
            return tableToRows(table);
        }
        function parseCsvTable(text) {
            const normalized = String(text || '').replace(/^\\uFEFF/, '');
            const rows = [];
            let row = [];
            let field = '';
            let inQuotes = false;
            for (let i = 0; i < normalized.length; i++) {
                const ch = normalized[i];
                const next = normalized[i + 1];
                if (inQuotes) {
                    if (ch === '"' && next === '"') {
                        field += '"';
                        i++;
                    } else if (ch === '"') {
                        inQuotes = false;
                    } else {
                        field += ch;
                    }
                } else if (ch === '"') {
                    inQuotes = true;
                } else if (ch === ',') {
                    row.push(field);
                    field = '';
                } else if (ch === '\\n') {
                    row.push(field);
                    rows.push(row);
                    row = [];
                    field = '';
                } else if (ch !== '\\r') {
                    field += ch;
                }
            }
            if (field !== '' || row.length) {
                row.push(field);
                rows.push(row);
            }
            return {
                headers: (rows.shift() || []).map(h => String(h || '').trim()),
                values: rows.filter(values => values.some(v => String(v || '').trim() !== ''))
            };
        }
        function tableToRows(table) {
            const headers = Array.isArray(table && table.headers) ? table.headers : [];
            const values = Array.isArray(table && table.values) ? table.values : [];
            return values.map(row => {
                const obj = {};
                headers.forEach((header, index) => {
                    obj[header || ('列' + (index + 1))] = row[index] !== undefined ? row[index] : '';
                });
                return obj;
            });
        }
        async function uploadBlob(name, blob) {
            if (!autoImport || !autoImport.uploadUrl || !blob || !name) return;
            if (hasRecentDirectCapture(name)) return;
            try {
                if (!window.__uivf12AutoImport) window.__uivf12AutoImport = { pending: [] };
                const pending = blob.text().then(function (text) {
                    const table = parseCsvTable(text);
                    if (!table.values.length) throw new Error('empty rows');
                    return uploadDataset(name, table);
                }).then(function (result) {
                    if (!result) throw new Error('upload failed');
                    recordAutoImportName(result.dataset && result.dataset.name ? result.dataset.name : name);
                    return result;
                }).catch(function (err) {
                    console.warn('[UIVF12 Auto Import] upload failed:', name, err);
                    recordAutoImportFailure(name, err && err.__uivDetail ? err.__uivDetail : { message: err && err.message ? err.message : 'Blob 自动导入失败' });
                    return null;
                });
                window.__uivf12AutoImport.pending.push(pending);
            } catch (err) {
                console.warn('[UIVF12 Auto Import] upload init failed:', name, err);
            }
        }
        async function uploadCsvText(name, csvText) {
            if (!autoImport || !autoImport.uploadUrl || !name) return null;
            try {
                const table = parseCsvTable(csvText);
                if (!table.values.length) throw new Error('empty rows');
                const result = await uploadDataset(name, table);
                if (!result) throw new Error('upload failed');
                markRecentDirectCapture(name);
                recordAutoImportName(result.dataset && result.dataset.name ? result.dataset.name : name);
                return result;
            } catch (err) {
                console.warn('[UIVF12 Auto Import] direct dataset upload failed:', name, err);
                recordAutoImportFailure(name, err && err.__uivDetail ? err.__uivDetail : { message: err && err.message ? err.message : '直接自动导入失败' });
                return null;
            }
        }
        function uploadViaBridge(name, table) {
            return new Promise(resolve => {
                if (!window.opener || window.opener.closed || !autoImport.bridgeOrigin) {
                    resolve(null);
                    return;
                }
                const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
                const timer = setTimeout(function () {
                    window.removeEventListener('message', onMessage);
                    resolve(null);
                }, 60000);
                function onMessage(event) {
                    const data = event.data || {};
                    if (!data || data.type !== 'uivf12-auto-import-ack' || data.requestId !== requestId) return;
                    clearTimeout(timer);
                    window.removeEventListener('message', onMessage);
                    if (data.ok) {
                        resolve({ ok: true, result: data.result || { ok: true } });
                    } else {
                        resolve({ ok: false, error: data.error || 'bridge upload failed', detail: data.detail || null });
                    }
                }
                window.addEventListener('message', onMessage);
                try {
                    window.opener.postMessage({
                        type: 'uivf12-auto-import-dataset',
                        requestId,
                        sessionId: autoImport.sessionId,
                        token: autoImport.token,
                        name: String(name),
                        table,
                        origin: location.origin,
                        groupName: autoImport.groupName || ''
                    }, autoImport.bridgeOrigin);
                } catch (error) {
                    clearTimeout(timer);
                    window.removeEventListener('message', onMessage);
                    resolve(null);
                }
            });
        }
        async function uploadDataset(name, table) {
            const bridgeResult = await uploadViaBridge(name, table);
            if (bridgeResult && bridgeResult.ok) return bridgeResult.result;
            const rows = tableToRows(table);
            try {
                const res = await fetch(autoImport.uploadUrl, {
                    method: 'POST',
                    mode: 'cors',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        name: String(name),
                        rows,
                        origin: location.origin,
                        groupName: autoImport.groupName || ''
                    })
                });
                const result = await res.json().catch(function () { return {}; });
                if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (result.error || 'upload failed'));
                return result;
            } catch (err) {
                console.warn('[UIVF12 Auto Import] fetch upload failed:', name, err);
                const detail = {
                    message: bridgeResult && bridgeResult.error ? bridgeResult.error : (err && err.message ? err.message : 'upload failed'),
                    bridgeError: bridgeResult && bridgeResult.error ? bridgeResult.error : '',
                    fetchError: err && err.message ? err.message : '',
                    rowCount: table && Array.isArray(table.values) ? table.values.length : rows.length,
                    headerCount: table && Array.isArray(table.headers) ? table.headers.length : 0,
                    approxBytes: (() => { try { return JSON.stringify(table || {}).length; } catch (e) { return 0; } })()
                };
                const wrapped = new Error(detail.message);
                wrapped.__uivDetail = detail;
                throw wrapped;
            }
        }
        function handleDownloadLink(link) {
            if (!link || !link.download || link.__uivf12DownloadHandled) return;
            link.__uivf12DownloadHandled = true;
            recordDownloadName(link.download);
            const blob = window.__uivf12ObjectUrlBlobs && window.__uivf12ObjectUrlBlobs.get(link.href);
            if (blob) uploadBlob(link.download, blob);
            setTimeout(function () {
                try { delete link.__uivf12DownloadHandled; } catch (e) {}
            }, 1000);
        }
        const bag = readWindowState();
        if (reset) {
            bag.uivf12Downloads = [];
            bag.uivf12AutoImportDatasets = [];
            bag.uivf12AutoImportFailures = [];
            bag.uivf12NoDownloadTasks = [];
            writeWindowState(bag);
        }
        if (!window.__uivf12DownloadRecorderBound) {
            window.__uivf12DownloadRecorderBound = true;
            window.__uivf12ObjectUrlBlobs = window.__uivf12ObjectUrlBlobs || new Map();
            window.__uivf12AutoImportCapture = uploadCsvText;
            const originalCreateObjectURL = URL.createObjectURL;
            URL.createObjectURL = function (value) {
                const url = originalCreateObjectURL.apply(URL, arguments);
                try {
                    if (value instanceof Blob) window.__uivf12ObjectUrlBlobs.set(url, value);
                } catch (e) {}
                return url;
            };
            const originalClick = HTMLAnchorElement.prototype.click;
            HTMLAnchorElement.prototype.click = function () {
                try {
                    handleDownloadLink(this);
                } catch (e) {}
                return originalClick.apply(this, arguments);
            };
            document.addEventListener('click', function (event) {
                try {
                    const link = event.target && event.target.closest ? event.target.closest('a[download]') : null;
                    handleDownloadLink(link);
                } catch (e) {}
            }, true);
            const originalFetch = window.fetch;
            if (typeof originalFetch === 'function') {
                window.fetch = async function () {
                    const started = Date.now();
                    const requestUrl = (() => {
                        try {
                            const input = arguments[0];
                            return typeof input === 'string' ? input : (input && input.url ? input.url : String(input || ''));
                        } catch (e) {
                            return '';
                        }
                    })();
                    try {
                        const response = await originalFetch.apply(this, arguments);
                        try {
                            const contentType = response.headers && response.headers.get ? response.headers.get('content-type') : '';
                            rememberFetchDiagnostic({
                                url: requestUrl,
                                status: response.status,
                                ok: response.ok,
                                redirected: response.redirected,
                                contentType: contentType || '',
                                durationMs: Date.now() - started
                            });
                        } catch (e) {}
                        return response;
                    } catch (error) {
                        rememberFetchDiagnostic({
                            url: requestUrl,
                            status: 'FETCH_ERROR',
                            ok: false,
                            error: error && error.message ? error.message : String(error),
                            durationMs: Date.now() - started
                        });
                        throw error;
                    }
                };
            }
        }
        window.__uivf12AutoImportCapture = uploadCsvText;
        return 'download-recorder-ready';
    })();`;
}

function injectUivAutoImportCapture(code) {
    const source = String(code || '');
    if (source.includes('__uivf12AutoImportCapture')) return source;
    const injection = 'if (window.__uivf12AutoImportCapture) await window.__uivf12AutoImportCapture(finalOutputName, csvContent);\n            ';
    const blobPattern = /const\s+blob\s*=\s*new\s+Blob\s*\(\s*\[\s*csvContent\s*\]\s*,\s*\{\s*type\s*:\s*(['"])text\/csv;charset=utf-8;\1\s*\}\s*\)\s*;/g;
    if (blobPattern.test(source)) {
        return source.replace(blobPattern, injection + '$&');
    }
    const linkPattern = /const\s+link\s*=\s*document\.createElement\s*\(\s*(['"])a\1\s*\)\s*;/;
    if (linkPattern.test(source)) {
        return source.replace(linkPattern, injection + '$&');
    }
    return source;
}

function buildUivAutoImportFlushScript() {
    return `return (async function () {
        try {
            const bridge = window.__uivf12AutoImport;
            const pending = bridge && Array.isArray(bridge.pending) ? bridge.pending.splice(0) : [];
            if (pending.length) await Promise.allSettled(pending);
            return 'auto-import-flushed:' + pending.length;
        } catch (error) {
            return 'auto-import-flush-failed:' + error.message;
        }
    })();`;
}

function buildUivCaptureCountScript() {
    return `return (function () {
        try {
            const parsed = window.name ? JSON.parse(window.name) : {};
            return JSON.stringify({
                downloads: Array.isArray(parsed.uivf12Downloads) ? parsed.uivf12Downloads.length : 0,
                imports: Array.isArray(parsed.uivf12AutoImportDatasets) ? parsed.uivf12AutoImportDatasets.length : 0
            });
        } catch (error) {
            return '{"downloads":0,"imports":0}';
        }
    })();`;
}

function buildUivTaskDownloadAuditScript(taskName, beforeVar, resultVar) {
    return `return (function () {
        function readWindowState() {
            try {
                const parsed = window.name ? JSON.parse(window.name) : {};
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch (e) {
                return {};
            }
        }
        function parseCounts(raw) {
            try {
                const parsed = JSON.parse(String(raw || '{}'));
                return {
                    downloads: Number.isFinite(Number(parsed.downloads)) ? Number(parsed.downloads) : 0,
                    imports: Number.isFinite(Number(parsed.imports)) ? Number(parsed.imports) : 0
                };
            } catch (e) {
                const fallback = parseInt(String(raw || '0'), 10);
                return { downloads: Number.isFinite(fallback) ? fallback : 0, imports: 0 };
            }
        }
        const before = parseCounts('${' + beforeVar + '}');
        const bag = readWindowState();
        const downloads = Array.isArray(bag.uivf12Downloads) ? bag.uivf12Downloads : [];
        const imports = Array.isArray(bag.uivf12AutoImportDatasets) ? bag.uivf12AutoImportDatasets : [];
        const fetchDiagnostics = Array.isArray(bag.uivf12FetchDiagnostics) ? bag.uivf12FetchDiagnostics : [];
        const after = { downloads: downloads.length, imports: imports.length };
        const downloadDelta = after.downloads - before.downloads;
        const importDelta = after.imports - before.imports;
        if (downloadDelta <= 0 && importDelta <= 0) {
            const list = Array.isArray(bag.uivf12NoDownloadTasks) ? bag.uivf12NoDownloadTasks : [];
            const scriptResult = String('${' + resultVar + '}' || '');
            const recentFetch = fetchDiagnostics.slice(-5).map(item => ({
                url: item && item.url ? String(item.url).slice(0, 260) : '',
                status: item && item.status !== undefined ? item.status : '',
                ok: item && item.ok !== undefined ? item.ok : '',
                redirected: item && item.redirected !== undefined ? item.redirected : '',
                contentType: item && item.contentType ? String(item.contentType).slice(0, 120) : '',
                error: item && item.error ? String(item.error).slice(0, 260) : '',
                durationMs: item && item.durationMs !== undefined ? item.durationMs : '',
                at: item && item.at ? item.at : ''
            }));
            list.push({
                name: ${JSON.stringify(taskName)},
                before: before.downloads,
                after: after.downloads,
                beforeImports: before.imports,
                afterImports: after.imports,
                result: scriptResult || '未检测到下载或自动导入数量增加',
                auditResult: '未检测到下载或自动导入数量增加',
                recentFetch,
                at: new Date().toISOString()
            });
            bag.uivf12NoDownloadTasks = list;
            window.name = JSON.stringify(bag);
            return 'no-download';
        }
        return 'captured:download+' + Math.max(0, downloadDelta) + ',import+' + Math.max(0, importDelta);
    })();`;
}

function buildUivBatchMacro(scriptsToRun, groupName, options = {}) {
    if (scriptsToRun.length === 0) {
        throw new Error(UIVT('uiv.copy.emptyGroup'));
    }

    const speed = UIV_BATCH_SPEEDS.includes(Number(options.speed)) ? Number(options.speed) : getUivBatchSpeed();
    const cooldownMs = getUivCooldownMs(speed);
    const autoImportSessionId = options.autoImportSessionId || makeRunnerId();
    const autoImportToken = options.autoImportToken || makeRunnerId();
    const autoImport = {
        sessionId: autoImportSessionId,
        token: autoImportToken,
        groupName,
        uploadUrl: `${window.location.origin}/api/uiv-auto-import/${autoImportSessionId}/datasets?token=${autoImportToken}`,
        slaUrl: `${window.location.origin}/sla?uivImportSession=${autoImportSessionId}&uivImportToken=${autoImportToken}&autoImport=1`,
        bridgeOrigin: window.location.origin
    };
    const commands = [];
    const usableScripts = scriptsToRun
        .map((script, index) => {
            const resolvedUrl = resolveUivScriptUrl(script);
            return {
                index,
                name: script.name || `Task ${index + 1}`,
                url: resolvedUrl,
                openUrl: resolveUivOpenUrl(script, resolvedUrl),
                code: injectUivAutoImportCapture(script.code || ''),
                loginProbeConfig: script.loginProbeConfig || null
            };
        })
        .filter(script => script.openUrl && script.code);

    if (usableScripts.length === 0) {
        throw new Error(UIVT('uiv.copy.noUivBatch'));
    }

    const groupedScripts = groupUivScriptsByOpenUrl(usableScripts);
    const tenantWarning = UIVT('uiv.repo.batchTenantWarning');
    const siteStates = groupedScripts.map((group, index) => ({
        label: `${index + 1}. ${group.openUrl}`,
        total: group.scripts.length,
        done: 0,
        status: 'pending'
    }));
    const panelLogs = [];

    function pushPanelCommand(phase, description, activeTask = null) {
        if (description) {
            const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
            panelLogs.push(`${stamp} ${description}`);
        }
        commands.push({
            Command: 'executeScript',
            Target: buildUivProgressPanelScript({
                groupName,
                phase,
                total: usableScripts.length,
                done: runIndex,
                sites: siteStates,
                logs: panelLogs,
                tenantWarning,
                activeTaskId: activeTask ? activeTask.id : '',
                activeTaskName: activeTask ? activeTask.name : ''
            }),
            Value: '',
            Description: 'Render UIVF12 floating progress panel.'
        });
    }

    commands.push({
        Command: 'echo',
        Target: `UIVF12 ${groupName} UI.Vision batch started. Total executable tasks: ${usableScripts.length}. Sites: ${groupedScripts.length}. Speed: ${speed}x. Cooldown: ${cooldownMs}ms`,
        Value: '',
        Description: ''
    }, {
        Command: 'executeScript',
        Target: buildUivBatchControlResetScript(),
        Value: '',
        Description: 'Reset UIVF12 batch control state.'
    }, {
        Command: 'executeScript',
        Target: buildUivDownloadRecorderScript({ reset: true, autoImport }),
        Value: '',
        Description: 'Reset and install UIVF12 download recorder and auto-import bridge.'
    }, {
        Command: 'store',
        Target: '900',
        Value: '!TIMEOUT_WAIT',
        Description: 'Allow long-running capture scripts to finish before UI.Vision marks the command as disconnected.'
    }, {
        Command: 'store',
        Target: '25',
        Value: '!TIMEOUT_PAGELOAD',
        Description: 'Keep site open checks tolerant; enterprise pages may keep loading background resources for minutes.'
    }, {
        Command: 'echo',
        Target: 'Preflight: XModules optional. This batch will not block if XModules are absent or disabled.',
        Value: '',
        Description: ''
    }, {
        Command: 'echo',
        Target: '如未安装或未启用 XModules，将继续执行抓取，文件按浏览器默认规则下载到默认下载目录。',
        Value: '',
        Description: ''
    }, {
        Command: 'echo',
        Target: 'Mac/Windows/Linux 均跳过阻断式本地命令探针，避免因平台命令差异导致批量任务失败。',
        Value: '',
        Description: ''
    });

    let runIndex = 0;
    groupedScripts.forEach((group, groupIndex) => {
        const groupProgress = `${groupIndex + 1}/${groupedScripts.length}`;
        const loginVar = `uivLoginOk_site_${groupIndex + 1}`;
        const loginStatusVar = `uivLoginStatus_site_${groupIndex + 1}`;
        const loginDetailVar = `uivLoginDetail_site_${groupIndex + 1}`;
        const compatVar = `uivLoginCompat_site_${groupIndex + 1}`;
        const isNetcareSite = String(group.openUrl || '').toLowerCase().includes('netcare');
        const siteWarmupMs = String(group.openUrl || '').toLowerCase().includes('netcare') ? 10000 : 5000;
        const siteControlVar = `uivBatchControl_site_${groupIndex + 1}`;
        siteStates[groupIndex].status = 'running';
        if (groupIndex > 0) {
            pushPanelCommand('切换站点', `准备打开 ${group.openUrl}`);
        }
        commands.push(
            { Command: 'executeScript', Target: buildUivBatchControlReadScript(), Value: siteControlVar, Description: 'Check whether the whole UIVF12 batch was stopped.' },
            { Command: 'gotoIf_v2', Target: '${' + siteControlVar + '} == "stop"', Value: 'UIVF12_BATCH_STOPPED', Description: '' },
            { Command: 'echo', Target: `[Site ${groupProgress}] Open ${group.openUrl} and run ${group.scripts.length} task(s)`, Value: '', Description: '' },
            { Command: 'store', Target: 'true', Value: '!ERRORIGNORE', Description: 'Do not fail the batch if a site keeps loading beyond UI.Vision page-load timeout.' },
            { Command: 'open', Target: group.openUrl, Value: '', Description: '' },
            { Command: 'pause', Target: String(siteWarmupMs), Value: '', Description: 'Give the site shell time to initialize even if the load event is noisy.' },
            { Command: 'store', Target: 'false', Value: '!ERRORIGNORE', Description: 'Resume strict error handling after tolerant site open.' },
            { Command: 'executeScript', Target: buildUivDownloadRecorderScript({ autoImport }), Value: '', Description: 'Install UIVF12 download recorder on the current site.' }
        );
        if (isNetcareSite) {
            commands.push(
                { Command: 'executeScript', Target: buildNetcareGlobalConfigCompatScript(), Value: compatVar, Description: 'Normalize NetCare globalConfig for legacy scripts.' },
                { Command: 'echo', Target: `[Site ${groupProgress}] NetCare globalConfig compat: ${'${' + compatVar + '}'}`, Value: '', Description: '' }
            );
        }
        pushPanelCommand('检测登录', `${group.openUrl} 页面已打开，开始检测登录态`);
        commands.push(
            { Command: 'executeScript', Target: group.loginProbe, Value: loginVar, Description: 'Check whether the current platform already has a login token.' },
            { Command: 'executeScript', Target: buildLoginProbeStatusScript(loginVar, group.openUrl), Value: loginStatusVar, Description: 'Normalize login probe result.' },
            { Command: 'executeScript', Target: buildAppendPanelLogScript(loginVar, group.openUrl), Value: loginDetailVar, Description: 'Append login probe detail to floating panel.' },
            { Command: 'echo', Target: `[Site ${groupProgress}] Login probe: ${'${' + loginDetailVar + '}'}`, Value: '', Description: '' },
            { Command: 'while_v2', Target: '${' + loginStatusVar + '} != "true" && ${' + siteControlVar + '} != "stop"', Value: '', Description: '' },
            { Command: 'executeScript', Target: `alert("UIVF12 批量任务等待登录：${group.openUrl}\\n\\n该站点共有 ${group.scripts.length} 个任务等待执行。请在当前页面完成登录。UI.Vision 会每 10 秒自动检测一次，检测到登录后继续执行。"); return "waiting-login";`, Value: '', Description: '' },
            { Command: 'pause', Target: '10000', Value: '', Description: '' },
            { Command: 'executeScript', Target: buildUivBatchControlReadScript(), Value: siteControlVar, Description: 'Allow Stop All to leave the login wait loop.' },
            { Command: 'executeScript', Target: group.loginProbe, Value: loginVar, Description: 'Re-check login token.' },
            { Command: 'executeScript', Target: buildLoginProbeStatusScript(loginVar, group.openUrl), Value: loginStatusVar, Description: 'Normalize login probe result.' },
            { Command: 'executeScript', Target: buildAppendPanelLogScript(loginVar, group.openUrl), Value: loginDetailVar, Description: 'Append login probe detail to floating panel.' },
            { Command: 'echo', Target: `[Site ${groupProgress}] Login probe: ${'${' + loginDetailVar + '}'}`, Value: '', Description: '' },
            { Command: 'endWhile', Target: '', Value: '', Description: '' },
            { Command: 'gotoIf_v2', Target: '${' + siteControlVar + '} == "stop"', Value: 'UIVF12_BATCH_STOPPED', Description: '' },
            { Command: 'echo', Target: `[Site ${groupProgress}] Login detected for ${group.openUrl}`, Value: '', Description: '' }
        );
        pushPanelCommand('站点执行中', `${group.openUrl} 已登录，开始执行 ${group.scripts.length} 个任务`);

        group.scripts.forEach(script => {
            const nextRunIndex = runIndex + 1;
            const progress = `${nextRunIndex}/${usableScripts.length}`;
            const resultVar = `uivResult_${nextRunIndex}`;
            const beforeCaptureVar = `uivCaptureBefore_${nextRunIndex}`;
            const auditVar = `uivDownloadAudit_${nextRunIndex}`;
            const taskId = `task-${nextRunIndex}`;
            const taskControlVar = `uivBatchControl_task_${nextRunIndex}`;
            pushPanelCommand('任务执行中', `开始 ${script.name}`, { id: taskId, name: script.name });
            commands.push(
                { Command: 'executeScript', Target: buildUivBatchControlReadScript(), Value: taskControlVar, Description: 'Check UIVF12 batch control before task.' },
                { Command: 'gotoIf_v2', Target: '${' + taskControlVar + '} == "stop"', Value: 'UIVF12_BATCH_STOPPED', Description: '' },
                { Command: 'echo', Target: `[${progress}] Run ${script.name}`, Value: '', Description: '' },
                { Command: 'executeScript', Target: buildUivCaptureCountScript(), Value: beforeCaptureVar, Description: `Record capture count before: ${script.name}` },
                { Command: 'executeScript', Target: buildUivControlledTaskScript(script.code, taskId, script.name), Value: resultVar, Description: `Run controllable UIVF12 script: ${script.name}` },
                { Command: 'gotoIf_v2', Target: '${' + resultVar + '} == "__UIVF12_STOPPED__"', Value: 'UIVF12_BATCH_STOPPED', Description: '' },
                { Command: 'pause', Target: '500', Value: '', Description: 'Let download click/import state settle before auditing.' },
                { Command: 'executeScript', Target: buildUivAutoImportFlushScript(), Value: '', Description: 'Wait for UIVF12 auto-import file upload.' },
                { Command: 'executeScript', Target: buildUivTaskDownloadAuditScript(script.name, beforeCaptureVar, resultVar), Value: auditVar, Description: `Audit download result: ${script.name}` },
                { Command: 'echo', Target: `[${progress}] ${script.name} result: ${'${' + resultVar + '}'}`, Value: '', Description: '' },
                { Command: 'echo', Target: `[${progress}] ${script.name} download audit: ${'${' + auditVar + '}'}`, Value: '', Description: '' },
                { Command: 'pause', Target: String(cooldownMs), Value: '', Description: `Cooldown adjusted by UIVF12 speed ${speed}x.` }
            );
            runIndex = nextRunIndex;
            siteStates[groupIndex].done += 1;
            pushPanelCommand('任务已处理', `已处理 ${script.name}`);
        });
        siteStates[groupIndex].status = 'done';
        pushPanelCommand('站点完成', `${group.openUrl} 站点任务完成`);
    });

    commands.push({
        Command: 'echo',
        Target: `UIVF12 ${groupName} UI.Vision batch finished.`,
        Value: '',
        Description: ''
    });
    pushPanelCommand('全部完成', '全部站点任务完成');
    commands.push({
        Command: 'executeScript',
        Target: buildUivAutoImportFlushScript(),
        Value: '',
        Description: 'Final wait for UIVF12 auto-import uploads.'
    }, {
        Command: 'executeScript',
        Target: buildUivCompletionDialogScript({
            groupName,
            taskCount: usableScripts.length,
            finishedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
            tenantWarning: UIVT('uiv.repo.batchTenantCompletionWarning'),
            autoImport
        }),
        Value: '',
        Description: 'Show UIVF12 completion summary dialog.'
    }, {
        Command: 'gotoLabel',
        Target: 'UIVF12_BATCH_END',
        Value: '',
        Description: ''
    }, {
        Command: 'label',
        Target: 'UIVF12_BATCH_STOPPED',
        Value: '',
        Description: ''
    }, {
        Command: 'echo',
        Target: 'UIVF12 batch stopped by user. Remaining tasks were skipped.',
        Value: '',
        Description: ''
    }, {
        Command: 'label',
        Target: 'UIVF12_BATCH_END',
        Value: '',
        Description: ''
    });

    return {
        Name: `UIVF12_${groupName}_Batch_UIV_${new Date().toISOString().slice(0, 10)}`,
        CreationDate: new Date().toISOString(),
        Commands: commands
    };
}

function buildAndCopyUivBatchMacro(scriptsToRun, groupName, speed = getUivBatchSpeed()) {
    let macro;
    try {
        macro = buildUivBatchMacro(scriptsToRun, groupName, { speed });
    } catch (error) {
        alert(error.message || UIVT('uiv.copy.emptyGroup'));
        return;
    }

    copyFromMemory(JSON.stringify(macro, null, 2), UIVT('uiv.copy.batchTypeUiv', { group: groupName }));
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

async function buildUivRunPayload(macro) {
    const origin = window.location.origin;
    const macroJson = JSON.stringify(macro);
    if (typeof CompressionStream === 'undefined') {
        return { macro, origin };
    }

    const stream = new Blob([macroJson], { type: 'application/json' })
        .stream()
        .pipeThrough(new CompressionStream('gzip'));
    const compressed = await new Response(stream).arrayBuffer();
    return {
        compressedMacro: {
            encoding: 'gzip-base64',
            originalBytes: new Blob([macroJson]).size,
            compressedBytes: compressed.byteLength,
            data: arrayBufferToBase64(compressed)
        },
        origin
    };
}

function makeRunnerId() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function openUivRunnerDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('uivf12-direct-runner', 1);
        request.onupgradeneeded = event => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('runs')) {
                db.createObjectStore('runs', { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('无法打开本地 IndexedDB'));
    });
}

async function saveLocalUivRun(runId, macro) {
    const db = await openUivRunnerDb();
    const payload = {
        id: runId,
        macro,
        origin: window.location.origin,
        createdAt: new Date().toISOString()
    };
    await new Promise((resolve, reject) => {
        const tx = db.transaction('runs', 'readwrite');
        tx.objectStore('runs').put(payload);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('写入本地 IndexedDB 失败'));
        tx.onabort = () => reject(tx.error || new Error('写入本地 IndexedDB 已中止'));
    });
    db.close();
}

async function openLocalUivRunner(macro, options = {}) {
    const runId = makeRunnerId();
    await saveLocalUivRun(runId, macro);
    const runnerUrl = `${window.location.origin}/pages/uivision-runner-local.html#${runId}`;
    const opened = window.open(runnerUrl, options.scheduled ? 'uivf12-scheduled-runner' : '_blank');
    if (!opened) {
        showToast('⚠️ 浏览器拦截了启动页弹窗，请允许本站弹窗后重试。', 'error');
    }
    return opened ? runnerUrl : '';
}

async function runAllUivScriptsDirect(options = {}) {
    try {
        const { scripts } = await API.get('/api/uiv/scripts');
        const scope = applyUivBatchCategoryFilter(scripts || []);
        const speed = getUivBatchSpeed();
        const autoImportSessionId = makeRunnerId();
        const autoImportToken = makeRunnerId();
        const autoImport = {
            sessionId: autoImportSessionId,
            token: autoImportToken,
            groupName: scope.groupName,
            uploadUrl: `${window.location.origin}/api/uiv-auto-import/${autoImportSessionId}/datasets?token=${autoImportToken}`
        };
        registerUivAutoImportBridge(autoImport);
        const macro = buildUivBatchMacro(scope.scripts, scope.groupName, { speed, autoImportSessionId, autoImportToken });
        const runnerUrl = await openLocalUivRunner(macro, options);
        if (!runnerUrl) {
            if (options.scheduled) showToast('⚠️ 定时运行被浏览器拦截，请先手动点击一次“运行批脚本”并允许弹窗。', 'error');
            return false;
        }
        showToast(UIVT('uiv.repo.batchTenantWarning'), 'warning');
        console.info('[UIVF12 Direct Run]', { mode: 'local-runner', url: runnerUrl, commands: macro.Commands.length, speed, scripts: scope.scripts.length, excludedCategories: scope.excluded });
        return true;
    } catch (error) {
        showToast(`❌ 直接运行失败：${error.message}`, 'error');
        if (!String(error.message || '').includes('批脚本执行范围')) {
            showUiVisionSetupDialog({ error: error.message });
        }
        console.error('[UIVF12 Direct Run] failed', error);
        return false;
    }
}

async function runTestUivScriptsDirect() {
    try {
        const { scripts } = await API.get('/api/uiv/scripts');
        const sampledScripts = sampleUivScriptsPerSite(scripts, 2);
        if (!sampledScripts.length) throw new Error(UIVT('uiv.copy.noUivBatch'));
        const speed = getUivBatchSpeed();
        const autoImportSessionId = makeRunnerId();
        const autoImportToken = makeRunnerId();
        const autoImport = {
            sessionId: autoImportSessionId,
            token: autoImportToken,
            groupName: '测试批脚本-每站点2个',
            uploadUrl: `${window.location.origin}/api/uiv-auto-import/${autoImportSessionId}/datasets?token=${autoImportToken}`
        };
        registerUivAutoImportBridge(autoImport);
        const macro = buildUivBatchMacro(sampledScripts, '测试批脚本-每站点2个', { speed, autoImportSessionId, autoImportToken });
        const runnerUrl = await openLocalUivRunner(macro);
        showToast(`✅ 已打开 UI.Vision 测试批脚本：${sampledScripts.length} 个任务`, 'success');
        showToast(UIVT('uiv.repo.batchTenantWarning'), 'warning');
        console.info('[UIVF12 Direct Test Run]', { mode: 'local-runner', url: runnerUrl, commands: macro.Commands.length, speed, scripts: sampledScripts.map(s => s.name) });
    } catch (error) {
        showToast(`❌ 测试批脚本启动失败：${error.message}`, 'error');
        showUiVisionSetupDialog({ error: error.message });
        console.error('[UIVF12 Direct Test Run] failed', error);
    }
}

function showUiVisionSetupDialog(detail = {}) {
    const old = document.getElementById('uivision-setup-dialog');
    if (old) old.remove();
    const overlay = document.createElement('div');
    overlay.id = 'uivision-setup-dialog';
    overlay.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:2147483000',
        'display:grid',
        'place-items:center',
        'background:rgba(2,6,23,.66)',
        'backdrop-filter:blur(8px)',
        'padding:20px'
    ].join(';');
    overlay.innerHTML = `
        <div style="width:min(560px,100%);background:#0f172a;border:1px solid rgba(96,165,250,.35);border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.38);padding:22px;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px;">
                <div>
                    <div style="font-size:18px;font-weight:800;color:#f8fafc;">需要启用 UI.Vision 环境</div>
                    <div style="font-size:12px;color:#93c5fd;margin-top:4px;">直接运行依赖浏览器插件接管 embedded macro。</div>
                </div>
                <button type="button" onclick="document.getElementById('uivision-setup-dialog').remove()" style="border:0;background:transparent;color:#94a3b8;font-size:22px;cursor:pointer;line-height:1;">×</button>
            </div>
            ${detail.error ? `<div style="font-size:12px;color:#fecaca;background:rgba(239,68,68,.12);border:1px solid rgba(248,113,113,.25);border-radius:8px;padding:9px 10px;margin-bottom:12px;">${String(detail.error).replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]))}</div>` : ''}
            <ol style="margin:0;padding-left:20px;color:#cbd5e1;font-size:13px;line-height:1.75;">
                <li>安装或启用浏览器插件：<a href="https://ui.vision/" target="_blank" rel="noopener" style="color:#67e8f9;font-weight:700;">https://ui.vision/</a></li>
                <li>打开 UI.Vision 插件设置，开启 <b>Allow Command Line</b>。</li>
                <li>开启 <b>Run embedded macros from public websites</b>，并把 <b>${window.location.origin}</b> 加入白名单。</li>
                <li>如需下载后自动移动到指定目录，再在插件设置里安装并启用 <b>XModules</b>；没装也能继续下载到浏览器默认下载目录。</li>
                <li>设置完成后回到本页面，再点一次“🚀 运行批脚本”。</li>
            </ol>
            <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px;">
                <a href="https://ui.vision/" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;justify-content:center;padding:9px 13px;border-radius:8px;background:#2563eb;color:white;text-decoration:none;font-size:13px;font-weight:700;">打开安装页面</a>
                <button type="button" onclick="document.getElementById('uivision-setup-dialog').remove()" style="padding:9px 13px;border-radius:8px;border:1px solid #334155;background:#111827;color:#cbd5e1;cursor:pointer;font-size:13px;">我知道了</button>
            </div>
        </div>
    `;
    overlay.addEventListener('click', event => {
        if (event.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
}

// Self-contained: copied F12 scripts run on the target site without platform assets.
function installFloatingCaptureTheme(root) {
    const host = root.host || root;
    const storageKey = 'uivf12-capture-theme-v1';
    const actions = root.querySelector('.head-actions');
    if (!actions) return;
    const existing = actions.querySelector('.capture-theme');
    if (existing) return;
    let theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    try {
        const saved = localStorage.getItem(storageKey);
        if (saved === 'light' || saved === 'dark') theme = saved;
    } catch (error) {}
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fullscreen capture-theme';
    actions.insertBefore(button, actions.firstChild);
    const style = document.createElement('style');
    const scope = root.host ? ':host([data-uiv-capture-theme="light"])' : '[data-uiv-capture-theme="light"]';
    const rules = [];
    function rule(selectors, declarations) {
        rules.push(selectors.split(',').map(selector => scope + ' ' + selector.trim()).join(',') + '{' + declarations + '}');
    }
    rules.push('.capture-theme{width:auto!important;min-width:58px;height:28px;padding:0 8px;border:1px solid #475569;border-radius:7px;background:#1e293b;color:#e2e8f0;font-size:10px;font-weight:800;white-space:nowrap;cursor:pointer}.capture-theme:focus-visible{outline:2px solid #38bdf8;outline-offset:2px}');
    rules.push(scope + '{color-scheme:light;color:#334155' + (root.host ? '' : ';background:#f8fafc') + '}');
    rule('.panel', 'background:rgba(255,255,255,.98);color:#334155;border-color:#b6dbe5;box-shadow:0 24px 80px rgba(30,41,59,.2);color-scheme:light');
    rule('.head,.detail-head,.file-tabs,.derived-metrics,.analysis-filters,.nc-toolbar,.nc-status,.nc-card-title,.nc-filter-row,.nc-eos-settings,.nc-option,.nc-card,.nc-sr-kpi,.df-card', 'border-color:#dbe4ee');
    rule('.title,.section-title,.detail-title,.derived-value,.close-choice-title,.nc-card-title,.nc-top-list b,.nc-eos-brief strong,.nc-change-filter-head strong,.nc-sr-kpi-value,.df-card header strong,.df-kpi strong,.df-operator-row>b,.df-operator-row>strong', 'color:#0f172a');
    rule('.meta,.metric-meta,.rule-snapshot,.page-info,.empty-detail,.close-choice-text,.derived-label,.derived-sub-label,.metric-target-label,.section-title small,.nc-status,.nc-card-title small,.nc-child,.nc-note,.nc-loading,.nc-empty,.nc-top-empty,.nc-merged-hint,.nc-bu-note,.nc-change-filter-head small,.nc-sr-kpi-label,.nc-sr-kpi-meta,.nc-sr-legend,.nc-sr-section-note,.df-status,.df-card small,.df-empty,.df-loading,.df-pager', 'color:#64748b');
    rule('.eyebrow,.target-month-hint,.derived-period,.nc-target,.nc-filter-label,.nc-top-customer-title', 'color:#0369a1');
    rule('.body,.nc-content,.df-content', 'color:#334155');
    rule('.status,.metric,.file-tab,.analysis-filter,.pager button,.fullscreen,.cancel-choice,.metric-target-item,.derived-sub,.nc-tab,.nc-refresh,.nc-language,.nc-json-button,.nc-plan-step,.nc-plan-preset,.nc-bulk-button,.nc-top-n-step,.nc-bu-chip,.nc-bu-all,.df-tab,.df-language,.df-json,.df-pager button,.df-pager select', 'background:#f1f5f9;color:#334155;border-color:#cbd5e1');
    rule('.capture-theme,.close', 'color:#334155');
    rule('.capture-theme', 'background:#f1f5f9;border-color:#cbd5e1');
    rule('.notice', 'background:#f5f3ff;color:#5b21b6;border-color:#ddd6fe');
    rule('.notice.running,.status.running', 'background:#ecfeff;color:#155e75;border-color:#a5f3fc');
    rule('.notice.done,.status.done', 'background:#f0fdf4;color:#166534;border-color:#bbf7d0');
    rule('.notice.bad,.status.bad', 'background:#fef2f2;color:#991b1b;border-color:#fecaca');
    rule('.metric:hover,.metric.active,.analysis-filter.active,.nc-tab.active,.nc-bu-all.active,.df-tab.active', 'background:#e0f2fe;color:#075985;border-color:#38bdf8');
    rule('.metric.has-danger', 'background:#fef2f2;border-color:#fca5a5');
    rule('.metric.has-warning:not(.has-danger)', 'background:#faf5ff;border-color:#c4b5fd');
    rule('.metric.has-kpi-warning:not(.has-danger)', 'background:#fff7ed;background-image:none;border-color:#fb923c');
    rule('.metric-risk,.metric-target-value,.derived-sub-value,.nc-top-list,.nc-readonly-plan', 'color:#334155');
    rule('.metric-risk .danger,.judgment-danger,.derived-gap,.derived-sub.missing .derived-sub-value,.nc-bad,.nc-error,.nc-sr-kpi.bad .nc-sr-kpi-value,.df-error', 'color:#b91c1c!important');
    rule('.metric-risk .warning,.judgment-warning', 'color:#7e22ce!important');
    rule('.metric-risk .info,.judgment-info', 'color:#0369a1!important');
    rule('.metric-risk .normal,.judgment-normal,.nc-good,.nc-sr-kpi.good .nc-sr-kpi-value', 'color:#15803d!important');
    rule('.nc-muted,.nc-merged-hint', 'color:#64748b!important');
    rule('.nc-sr-kpi.warn .nc-sr-kpi-value,.derived-sub-gap', 'color:#b45309');
    rule('.detail,.derived-metrics,.nc-mode,.df-mode,.nc-card,.nc-sr-kpi,.df-card,.nc-eos-card.nc-eos-fullscreen', 'background:#fff;background-image:none');
    rule('.target-month-bar,.metric-target-item.current,.rerun-one,.nc-eos-settings,.nc-option,.nc-change-filter,.nc-eos-brief', 'background:#f0f9ff;background-image:none;color:#075985;border-color:#bae6fd');
    rule('.nc-toolbar,.nc-card-title,.nc-eos-card.nc-eos-fullscreen .nc-card-title,.df-toolbar', 'background:#f8fafc;background-image:none');
    rule('.target-month-select,.nc-eos-settings input,.nc-eos-settings select,.nc-plan-input,.nc-progress-note,.nc-progress-note:focus,.df-toolbar input,.df-toolbar select', 'background:#fff;color:#0f172a;border-color:#94a3b8');
    rule('.nc-progress-note::placeholder', 'color:#64748b');
    rule('.file-tab.active', 'background:#ede9fe;color:#5b21b6;border-color:#a78bfa');
    rule('.derived-chip', 'background:#f0fdf4;border-color:#bbf7d0');
    rule('.derived-chip.warn,.derived-sub.warn', 'background:#fff7ed;background-image:none');
    rule('.derived-sub.missing', 'background:#fef2f2');
    rule('.data-table th,.nc-table th,.df-table-wrap th', 'background:#eaf2f8;color:#075985');
    rule('.data-table td,.nc-table td,.df-table-wrap td', 'color:#334155;border-color:#e2e8f0');
    rule('.data-table th,.nc-table th,.df-table-wrap th', 'border-color:#dbe4ee');
    rule('.data-table th.column-analysis,.data-table td.column-analysis,.data-table tr.risk-info td', 'background:#ecfeff;color:#155e75');
    rule('.data-table th.column-association,.data-table td.column-association,.data-table th.column-rule,.data-table td.column-rule,.data-table tr.risk-warning td', 'background:#f5f3ff;color:#5b21b6');
    rule('.data-table th.column-output,.data-table td.column-output', 'background:#f0fdf4;color:#166534');
    rule('.data-table tr.risk-danger td', 'background:#fef2f2');
    rule('.data-table th.sortable:hover', 'color:#075985;filter:none');
    rule('.close-choice', 'background:rgba(226,232,240,.8)');
    rule('.close-choice-card', 'background:#fff;border-color:#cbd5e1');
    rule('.nc-table .nc-total td,.nc-bg-divider td', 'background:#e0f2fe!important;color:#075985!important');
    rule('.nc-table .nc-bg td,.nc-merged-row td,.nc-customer-divider td', 'background:#f1f5f9!important;color:#334155!important');
    rule('.nc-merged-row.line td,.nc-line-divider td', 'background:#f8fafc!important;color:#64748b!important');
    rule('.nc-merged-label', 'color:#0f172a!important');
    rule('.nc-product-divider td', 'color:#0369a1!important');
    rule('.nc-eos-sticky-item.bg', 'background:#e0f2fe;color:#075985');
    rule('.nc-eos-sticky-item.customer,.nc-eos-sticky-item.line,.nc-eos-sticky-item.product', 'background:#f1f5f9;color:#334155');
    rule('.nc-bu-chip:has(input:checked)', 'background:#dbeafe;color:#1e40af');
    rule('.nc-plan-preset[data-plan-action="all"],.nc-bulk-button[data-bulk-action="all"]', 'background:#dcfce7;color:#166534');
    rule('.nc-plan-preset[data-plan-action="clear"],.nc-bulk-button[data-bulk-action="clear"]', 'background:#fee2e2;color:#991b1b');
    rule('.nc-bulk-button[data-bulk-action="topn"],.nc-top-n-step,.nc-json-button', 'background:#fef3c7;color:#92400e');
    rule('.nc-bulk-button[data-collapse-action]', 'background:#ede9fe;color:#5b21b6');
    rule('.nc-collapse-button,.nc-bulk-button[data-collapse-action="expand"],.nc-language', 'background:#e0f2fe;color:#075985');
    rule('.nc-table-fullscreen-button', 'background:#ede9fe!important;color:#5b21b6!important');
    rule('.nc-eos-fullscreen .nc-table-fullscreen-button', 'background:#fee2e2!important;color:#991b1b!important');
    rule('.nc-status.review,.df-status.review', 'background:#fff1f2;color:#9f1239');
    rule('.nc-sr-chart', 'background:#f8fafc');
    rule('.nc-sr-chart-title,.nc-sr-chart-value', 'fill:#334155');
    rule('.nc-sr-chart-axis,.nc-sr-chart-legend', 'fill:#64748b');
    rule('.nc-sr-severity', 'background:#e2e8f0');
    rule('.nc-eos-brief-title', 'color:#0f172a');
    rule('.nc-eos-brief.version strong', 'color:#6d28d9');
    rule('.nc-eos-brief .nc-brief-focus', 'color:#b45309');
    rule('.nc-eos-brief .nc-brief-good', 'color:#15803d');
    rule('.nc-eos-brief .nc-brief-gap', 'color:#b91c1c');
    rule('.df-kpi,.df-operator-brief', 'background:#f8fafc;background-image:none;border-color:#dbe4ee');
    rule('.df-kpi>span,.df-insight-row,.df-reason-row,.df-operator-row,.df-operator-brief p', 'color:#334155');
    rule('.df-summary.good,.df-operator-rate.good', 'background:#f0fdf4;color:#166534');
    rule('.df-summary.bad,.df-operator-rate.bad,.df-operator-brief.risk', 'background:#fef2f2;background-image:none;color:#991b1b');
    rule('.df-operator-brief strong', 'color:#1e40af');
    rule('.df-operator-brief.risk strong', 'color:#991b1b');
    rule('.df-recent-row td', 'background:#fffbeb!important;color:#92400e!important');
    rule('.df-control,.df-actions select,.df-actions input[type=number]', 'background:#fff;color:#334155;border-color:#cbd5e1');
    rule('.df-scope-toggle,.df-legend,.df-rank,.df-summary b,.df-pager b', 'color:#334155');
    rule('.df-chart-svg text', 'fill:#64748b');
    rule('.df-chart-svg .df-chart-value', 'fill:#334155');
    rule('.df-chart-svg .df-target-label', 'fill:#b45309');
    rule('.df-kpi.good strong,.df-good', 'color:#15803d!important');
    rule('.df-kpi.bad strong,.df-bad', 'color:#b91c1c!important');
    rule('.uiv-topic-simulator-float-head', 'background:#f8fafc;border-color:#dbe4ee');
    rule('.uiv-topic-simulator-float-head strong', 'color:#0f172a');
    style.textContent = rules.join('\n');
    root.appendChild(style);
    function english() {
        const languageButton = root.querySelector('.nc-language,.df-language');
        if (languageButton) return languageButton.textContent.trim() === '中';
        return String(document.documentElement.lang || '').startsWith('en');
    }
    function render() {
        host.setAttribute('data-uiv-capture-theme', theme);
        host.style.colorScheme = theme;
        const light = theme === 'light';
        button.textContent = light ? (english() ? '☾ Dark' : '☾ 暗色') : (english() ? '☀ Light' : '☀ 亮色');
        button.title = english() ? (light ? 'Switch to dark mode' : 'Switch to light mode') : (light ? '切换为暗色模式' : '切换为亮色模式');
        button.setAttribute('aria-label', button.title);
        button.setAttribute('aria-pressed', String(light));
    }
    button.addEventListener('click', () => {
        theme = theme === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(storageKey, theme); } catch (error) {}
        render();
    });
    root.addEventListener('click', event => {
        if (event.target.closest('.nc-language,.df-language')) render();
    });
    render();
}

function wrapMasterScriptWithFloatingLauncher(masterCode, options = {}) {
    const siteName = String(options.siteName || '当前站点');
    const expectedOrigin = String(options.expectedOrigin || '');
    const taskCount = Math.max(0, Number(options.taskCount) || 0);
    const taskMeta = Array.isArray(options.taskMeta) ? options.taskMeta : [];
    const ruleBundle = options.ruleBundle && typeof options.ruleBundle === 'object' ? options.ruleBundle : {};
    const netCareRuntimeSource = expectedOrigin === 'https://netcare.huawei.com' && (options.netCareRuntimeSource
        || (window.UIVNetCareAnalysis && typeof window.UIVNetCareAnalysis.getRuntimeSource === 'function'
            ? window.UIVNetCareAnalysis.getRuntimeSource()
            : ''));
    const dataFabRuntimeSource = expectedOrigin === 'https://datafab-pro.gtsdata.huawei.com' && (options.dataFabRuntimeSource
        || (window.UIVDataFabAnalysis && typeof window.UIVDataFabAnalysis.getRuntimeSource === 'function'
            ? window.UIVDataFabAnalysis.getRuntimeSource()
            : ''));
    return `(function () {
    const TOOL_ID = 'uivf12-floating-capture-tool';
    const oldTool = document.getElementById(TOOL_ID);
    if (oldTool) {
        oldTool.style.display = 'block';
        return;
    }

    const expectedOrigin = ${JSON.stringify(expectedOrigin)};
    const taskMeta = ${JSON.stringify(taskMeta)};
    const ruleBundle = ${JSON.stringify(ruleBundle)};
    const installNetCareAnalysisRuntime = ${netCareRuntimeSource || 'null'};
    const installDataFabAnalysisRuntime = ${dataFabRuntimeSource || 'null'};
    const installFloatingThemeRuntime = ${installFloatingCaptureTheme.toString()};
    const originMatched = !expectedOrigin || window.location.origin === expectedOrigin;
    const capturedFiles = [];
    const taskStates = new Map(taskMeta.map(function (task) { return [task.index, 'pending']; }));
    const taskRunners = new Map();
    let currentTask = null;
    let captureActive = false;
    let minimized = false;
    let terminated = false;
    let selectedTaskIndex = null;
    let selectedFileIndex = 0;
    let currentPage = 1;
    let selectedRiskFilter = 'all';
    let detailSortKey = 'auto';
    let detailSortDirection = 'asc';
    let selectedTargetMonth = defaultTargetMonth();
    let resultMode = false;
    let fullscreen = false;
    let controlShieldHost = null;
    let shieldToastTimer = null;
    const pageSize = 100;
    const host = document.createElement('div');
    host.id = TOOL_ID;
    host.style.cssText = 'position:fixed;top:18px;right:18px;z-index:2147483647;width:min(420px,calc(100vw - 36px));min-width:0;max-width:calc(100vw - 36px);box-sizing:border-box;contain:layout style;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;transition:width .22s ease;';
    const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    root.innerHTML = \`
        <style>
            *{box-sizing:border-box}
            .panel{position:relative;width:100%;min-width:0;max-width:100%;overflow:hidden;max-height:calc(100vh - 36px);display:flex;flex-direction:column;border:1px solid rgba(103,232,249,.42);border-radius:15px;background:rgba(15,23,42,.97);color:#e2e8f0;box-shadow:0 24px 80px rgba(0,0,0,.46);backdrop-filter:blur(12px)}
            .head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:15px 16px 12px;border-bottom:1px solid rgba(148,163,184,.18)}
            .eyebrow{color:#67e8f9;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.title{margin-top:4px;color:#f8fafc;font-size:16px;font-weight:850}.meta{margin-top:5px;color:#94a3b8;font-size:11px;line-height:1.5}
            .close{border:0;background:transparent;color:#94a3b8;font-size:22px;line-height:1;cursor:pointer}.body{width:100%;min-width:0;max-width:100%;padding:14px 16px 16px;overflow-x:hidden;overflow-y:auto}.notice{padding:10px 11px;border:1px solid rgba(167,139,250,.28);border-radius:9px;background:rgba(76,29,149,.16);color:#ddd6fe;font-size:11px;line-height:1.55}.notice.running{border-color:rgba(34,211,238,.34);background:rgba(14,116,144,.17);color:#a5f3fc}.notice.done{border-color:rgba(74,222,128,.34);background:rgba(21,128,61,.16);color:#bbf7d0}.notice.bad{border-color:rgba(248,113,113,.34);background:rgba(153,27,27,.16);color:#fecaca}
            .status{margin:11px 0;padding:9px 10px;border-radius:8px;background:rgba(30,41,59,.72);color:#cbd5e1;font-size:11px;line-height:1.5}.status.bad{border:1px solid rgba(248,113,113,.3);color:#fecaca}.status.running{border:1px solid rgba(34,211,238,.3);color:#a5f3fc}.status.done{border:1px solid rgba(74,222,128,.3);color:#bbf7d0}
            .actions{display:flex;gap:8px}.start,.zip{flex:1;padding:10px 12px;border:1px solid #67e8f9;border-radius:9px;background:linear-gradient(135deg,#0e7490,#4f46e5);color:#fff;font-size:12px;font-weight:850;cursor:pointer}.start:hover,.zip:hover{filter:brightness(1.12)}.start:disabled,.zip:disabled{cursor:not-allowed;filter:grayscale(.55);opacity:.58}.zip{display:none;border-color:#86efac;background:linear-gradient(135deg,#15803d,#0f766e)}
            .results{display:none;width:100%;min-width:0;max-width:100%;margin-top:13px}.section-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;color:#e2e8f0;font-size:12px;font-weight:850}.section-title small{color:#94a3b8;font-size:10px;font-weight:600}.rule-snapshot{margin:-3px 0 9px;color:#64748b;font-size:9px}.metrics{width:100%;min-width:0;max-width:100%;display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:7px}.metric{width:100%;min-width:0;max-width:100%;padding:8px 9px;border:1px solid rgba(148,163,184,.24);border-radius:8px;background:rgba(30,41,59,.76);color:#cbd5e1;text-align:left;cursor:pointer}.metric:hover,.metric.active{border-color:#67e8f9;background:rgba(14,116,144,.24);color:#fff}.metric.has-danger{border-color:rgba(248,113,113,.58);background:rgba(127,29,29,.22)}.metric.has-warning:not(.has-danger){border-color:rgba(192,132,252,.5);background:rgba(88,28,135,.19)}.metric.has-kpi-warning{box-shadow:inset 0 0 0 1px rgba(251,146,60,.2),0 0 14px rgba(249,115,22,.12)}.metric.has-kpi-warning:not(.has-danger){border-color:rgba(251,146,60,.72);background-image:linear-gradient(135deg,rgba(154,52,18,.2),rgba(30,41,59,.3))}.metric.empty{opacity:.58}.metric-name{display:block;width:100%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:800}.metric-meta{display:block;margin-top:4px;color:#94a3b8;font-size:9px}.metric-risk{display:block;margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#cbd5e1;font-size:9px;font-weight:750}.metric-risk .danger{color:#fca5a5}.metric-risk .warning{color:#d8b4fe}.metric-risk .info{color:#7dd3fc}.metric-risk .normal{color:#86efac}
            .detail{display:none;width:100%;min-width:0;max-width:100%;margin-top:12px;border:1px solid rgba(148,163,184,.2);border-radius:10px;overflow:hidden;background:rgba(2,6,23,.46)}.detail-head{width:100%;min-width:0;max-width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 11px;border-bottom:1px solid rgba(148,163,184,.18)}.detail-title{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#f8fafc;font-size:12px;font-weight:850}.rerun-one{flex:0 0 auto;padding:6px 9px;border:1px solid rgba(103,232,249,.42);border-radius:7px;background:rgba(14,116,144,.2);color:#a5f3fc;font-size:9px;font-weight:800;cursor:pointer}.rerun-one:hover{background:rgba(14,116,144,.38)}.rerun-one:disabled{cursor:not-allowed;opacity:.5}.file-tabs{width:100%;min-width:0;max-width:100%;display:flex;flex-wrap:nowrap;gap:5px;padding:8px 10px;border-bottom:1px solid rgba(148,163,184,.14);overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain}.file-tab{flex:0 0 auto;width:min(210px,70%);min-width:0;max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:5px 7px;border:1px solid rgba(148,163,184,.24);border-radius:6px;background:#1e293b;color:#cbd5e1;font-size:9px;cursor:pointer}.file-tab.active{border-color:#a78bfa;color:#fff;background:#4c1d95}.derived-metrics{display:none;flex-wrap:wrap;align-items:flex-start;gap:7px;padding:8px 10px;border-bottom:1px solid rgba(148,163,184,.14);background:rgba(15,23,42,.48)}.derived-chip{flex:1 1 180px;min-width:150px;max-width:340px;padding:8px;border:1px solid rgba(74,222,128,.28);border-radius:8px;background:rgba(21,128,61,.12)}.derived-chip.warn{border-color:rgba(251,146,60,.72);background:linear-gradient(135deg,rgba(154,52,18,.26),rgba(127,29,29,.16));box-shadow:0 0 15px rgba(249,115,22,.12)}.derived-label{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#94a3b8;font-size:8px}.derived-period{display:block;margin-top:2px;color:#7dd3fc;font-size:7px;font-weight:750}.derived-value{display:block;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#f8fafc;font-size:13px;font-weight:850}.derived-gap{display:block;margin-top:2px;color:#fca5a5;font-size:8px}.derived-subs{display:grid;grid-template-columns:repeat(auto-fit,minmax(62px,1fr));gap:4px;margin-top:7px;padding-top:6px;border-top:1px solid rgba(148,163,184,.14)}.derived-sub{min-width:0;padding:4px 5px;border-radius:5px;background:rgba(15,23,42,.58);text-align:center}.derived-sub.warn{box-shadow:inset 0 0 0 1px rgba(251,146,60,.65);background:rgba(154,52,18,.3)}.derived-sub-label,.derived-sub-value,.derived-sub-gap{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.derived-sub-label{color:#94a3b8;font-size:7px}.derived-sub-value{margin-top:2px;color:#e0f2fe;font-size:9px;font-weight:800}.derived-sub-gap{margin-top:2px;color:#fdba74;font-size:6px}.analysis-filters{display:none;flex-wrap:wrap;gap:5px;padding:7px 10px;border-bottom:1px solid rgba(148,163,184,.14)}.analysis-filter{padding:5px 8px;border:1px solid rgba(148,163,184,.23);border-radius:999px;background:#1e293b;color:#94a3b8;font-size:9px;cursor:pointer}.analysis-filter.active{border-color:#67e8f9;color:#fff;background:#0e7490}.table-wrap{width:100%;min-width:0;max-width:100%;max-height:330px;overflow:auto;overscroll-behavior:contain}.data-table{width:max-content;min-width:100%;max-width:none;border-collapse:collapse;font-size:10px}.data-table th{position:sticky;top:0;z-index:1;background:#172033;color:#bae6fd}.data-table th,.data-table td{max-width:300px;padding:6px 8px;border-right:1px solid rgba(148,163,184,.13);border-bottom:1px solid rgba(148,163,184,.13);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}.data-table td{color:#cbd5e1}.data-table tr.risk-danger td{background:rgba(127,29,29,.22)}.data-table tr.risk-warning td{background:rgba(88,28,135,.18)}.data-table tr.risk-info td{background:rgba(14,116,144,.14)}.judgment-danger{color:#fca5a5!important;font-weight:800}.judgment-warning{color:#d8b4fe!important;font-weight:800}.judgment-info{color:#7dd3fc!important;font-weight:800}.judgment-normal{color:#86efac!important}.empty-detail{padding:22px;color:#94a3b8;text-align:center;font-size:11px}.pager{display:flex;align-items:center;justify-content:flex-end;gap:7px;padding:8px 10px}.pager button{padding:4px 8px;border:1px solid rgba(148,163,184,.25);border-radius:6px;background:#1e293b;color:#cbd5e1;font-size:9px;cursor:pointer}.page-info{color:#94a3b8;font-size:9px}
            .mini-launch{display:none;width:54px;height:54px;align-items:center;justify-content:center;border:1px solid rgba(103,232,249,.55);border-radius:50%;background:linear-gradient(135deg,#0e7490,#4f46e5);color:#fff;box-shadow:0 12px 38px rgba(0,0,0,.42);font-size:23px;cursor:pointer}.mini-launch.running{animation:miniPulse 1.4s ease-in-out infinite}@keyframes miniPulse{0%,100%{box-shadow:0 12px 38px rgba(0,0,0,.42),0 0 0 0 rgba(34,211,238,.45)}50%{box-shadow:0 12px 38px rgba(0,0,0,.42),0 0 0 9px rgba(34,211,238,0)}}
            .close-choice{position:absolute;inset:0;z-index:10;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(2,6,23,.78);backdrop-filter:blur(7px)}.close-choice-card{width:min(390px,100%);padding:17px;border:1px solid rgba(167,139,250,.38);border-radius:12px;background:#111827;box-shadow:0 18px 55px rgba(0,0,0,.4)}.close-choice-title{color:#f8fafc;font-size:14px;font-weight:850}.close-choice-text{margin-top:6px;color:#94a3b8;font-size:10px;line-height:1.55}.close-choice-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:14px}.close-choice-actions button{padding:9px 8px;border-radius:8px;font-size:10px;font-weight:800;cursor:pointer}.minimize-choice{border:1px solid #67e8f9;background:#0e7490;color:#fff}.terminate-choice{border:1px solid #f87171;background:#991b1b;color:#fff}.cancel-choice{grid-column:1/-1;border:1px solid #475569;background:#1e293b;color:#cbd5e1}
            .derived-sub.missing{background:rgba(127,29,29,.28)}.derived-sub.missing .derived-sub-value{color:#fca5a5}
            .head-actions{display:flex;align-items:center;gap:5px}.fullscreen{width:30px;height:28px;border:1px solid rgba(148,163,184,.24);border-radius:7px;background:rgba(30,41,59,.7);color:#cbd5e1;font-size:14px;cursor:pointer}.fullscreen:hover{border-color:#67e8f9;color:#fff}
            .panel>.body{flex:1;min-height:0}
            .target-month-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 9px;padding:7px 9px;border:1px solid rgba(103,232,249,.2);border-radius:8px;background:rgba(14,116,144,.1);color:#cbd5e1;font-size:9px}.target-month-bar label{display:flex;align-items:center;gap:6px;font-weight:800}.target-month-select{padding:4px 22px 4px 7px;border:1px solid rgba(103,232,249,.35);border-radius:6px;background:#172033;color:#e0f2fe;font-size:9px;font-weight:800;cursor:pointer}.target-month-hint{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#67e8f9}.metric-target-window{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin-top:7px}.metric-target-item{min-width:0;padding:4px;border:1px solid rgba(148,163,184,.14);border-radius:5px;background:rgba(2,6,23,.34);text-align:center}.metric-target-item.current{border-color:rgba(103,232,249,.35);background:rgba(14,116,144,.18)}.metric-target-label,.metric-target-value{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.metric-target-label{color:#64748b;font-size:7px}.metric-target-value{margin-top:2px;color:#cbd5e1;font-size:8px;font-weight:800}.metric-target-item.current .metric-target-value{color:#a5f3fc}
            .data-table th.column-analysis{background:#123044;color:#a5f3fc;box-shadow:inset 3px 0 0 #22d3ee}.data-table td.column-analysis{background:rgba(14,116,144,.16);box-shadow:inset 3px 0 0 rgba(34,211,238,.42)}.data-table th.column-association{background:#30204b;color:#ddd6fe;box-shadow:inset 3px 0 0 #a78bfa}.data-table td.column-association{max-width:360px;background:rgba(88,28,135,.16);color:#ddd6fe;font-weight:700;box-shadow:inset 3px 0 0 rgba(167,139,250,.4)}.data-table th.column-output{background:#123b32;color:#bbf7d0;box-shadow:inset 3px 0 0 #4ade80}.data-table td.column-output{background:rgba(21,128,61,.14);color:#bbf7d0;font-weight:800;box-shadow:inset 3px 0 0 rgba(74,222,128,.36)}.data-table th.column-rule{background:#292342;color:#ddd6fe}.data-table td.column-rule{background:rgba(76,29,149,.1);color:#ddd6fe}.data-table th.sortable{cursor:pointer;user-select:none;padding-right:22px}.data-table th.sortable:hover{filter:brightness(1.16);color:#fff}.data-table th.sortable::after{content:'↕';position:absolute;right:7px;color:#64748b;font-size:9px}.data-table th.sortable.sort-asc::after{content:'↑';color:#67e8f9}.data-table th.sortable.sort-desc::after{content:'↓';color:#67e8f9}.data-table th.sortable:focus-visible{outline:2px solid #67e8f9;outline-offset:-2px}
            @media(max-width:680px){.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.detail-head{align-items:flex-start;flex-direction:column}.table-wrap{max-height:280px}}
        </style>
        <button class="mini-launch" type="button" title="恢复数据抓取浮窗">📊</button>
        <section class="panel">
            <header class="head">
                <div><div class="eyebrow">UIVF12 Capture Panel</div><div class="title"></div><div class="meta"></div></div>
                <div class="head-actions"><button class="fullscreen" type="button" title="全屏查看">⛶</button><button class="close" type="button" title="关闭浮窗">×</button></div>
            </header>
            <div class="body">
                <div class="notice">脚本已载入，但尚未开始抓取。确认当前站点与登录状态后，再点击下方按钮。</div>
                <div class="status"></div>
                <div class="actions"><button class="start" type="button">开始抓取 ${taskCount} 个任务</button><button class="zip" type="button">下载全部 CSV（ZIP）</button></div>
                <section class="results">
                    <div class="section-title"><span>指标数据</span><small class="result-summary"></small></div>
                    <div class="rule-snapshot"></div>
                    <div class="target-month-bar"><label>目标月份 <select class="target-month-select"></select></label><span class="target-month-hint"></span></div>
                    <div class="metrics"></div>
                    <div class="detail">
                        <div class="detail-head"><div class="detail-title"></div><button class="rerun-one" type="button">重新抓取当前指标</button></div>
                        <div class="file-tabs"></div>
                        <div class="derived-metrics"></div>
                        <div class="analysis-filters"></div>
                        <div class="table-wrap"></div>
                        <div class="pager"><button class="prev" type="button">上一页</button><span class="page-info"></span><button class="next" type="button">下一页</button></div>
                    </div>
                </section>
            </div>
            <div class="close-choice">
                <div class="close-choice-card">
                    <div class="close-choice-title">关闭数据抓取浮窗？</div>
                    <div class="close-choice-text">可以缩小到右下角继续保留数据，也可以彻底结束本次浮窗脚本。</div>
                    <div class="close-choice-actions">
                        <button class="minimize-choice" type="button">缩小到右下角</button>
                        <button class="terminate-choice" type="button">彻底关闭</button>
                        <button class="cancel-choice" type="button">取消</button>
                    </div>
                </div>
            </div>
        </section>\`;
    const title = root.querySelector('.title');
    const meta = root.querySelector('.meta');
    const notice = root.querySelector('.notice');
    const status = root.querySelector('.status');
    const startButton = root.querySelector('.start');
    const zipButton = root.querySelector('.zip');
    const fullscreenButton = root.querySelector('.fullscreen');
    const closeButton = root.querySelector('.close');
    const panel = root.querySelector('.panel');
    const miniButton = root.querySelector('.mini-launch');
    const closeChoice = root.querySelector('.close-choice');
    const minimizeChoice = root.querySelector('.minimize-choice');
    const terminateChoice = root.querySelector('.terminate-choice');
    const cancelChoice = root.querySelector('.cancel-choice');
    const results = root.querySelector('.results');
    const metrics = root.querySelector('.metrics');
    const resultSummary = root.querySelector('.result-summary');
    const ruleSnapshot = root.querySelector('.rule-snapshot');
    const targetMonthSelect = root.querySelector('.target-month-select');
    const targetMonthHint = root.querySelector('.target-month-hint');
    const detail = root.querySelector('.detail');
    const detailTitle = root.querySelector('.detail-title');
    const rerunOneButton = root.querySelector('.rerun-one');
    const fileTabs = root.querySelector('.file-tabs');
    const derivedMetrics = root.querySelector('.derived-metrics');
    const analysisFilters = root.querySelector('.analysis-filters');
    const tableWrap = root.querySelector('.table-wrap');
    const prevButton = root.querySelector('.prev');
    const nextButton = root.querySelector('.next');
    const pageInfo = root.querySelector('.page-info');
    let netCareController = null;
    if (typeof installNetCareAnalysisRuntime === 'function') {
        try {
            netCareController = installNetCareAnalysisRuntime(root, { isCaptureActive: function () { return captureActive; } });
        } catch (error) {
            console.error('[UIVF12] NetCare 专题模块初始化失败', error);
        }
    }
    let dataFabController = null;
    if (typeof installDataFabAnalysisRuntime === 'function') {
        try {
            dataFabController = installDataFabAnalysisRuntime(root, { isCaptureActive: function () { return captureActive; } });
        } catch (error) {
            console.error('[UIVF12] DataFab 专题模块初始化失败', error);
        }
    }
    installFloatingThemeRuntime(root);
    title.textContent = ${JSON.stringify(siteName)} + ' · 数据抓取浮窗';
    meta.textContent = ${JSON.stringify(`${taskCount} 个仓库脚本 · ${expectedOrigin || '当前站点'}`)};
    ruleSnapshot.textContent = ruleBundle.unavailable
        ? '规则快照不可用：本次仅展示原始数据'
        : 'SLA 规则快照 · ' + (ruleBundle.exportedAt ? new Date(ruleBundle.exportedAt).toLocaleString() : '复制时生成');
    for (let month = 1; month <= 12; month++) {
        const option = document.createElement('option');
        option.value = String(month);
        option.textContent = month + '月';
        targetMonthSelect.appendChild(option);
    }
    targetMonthSelect.value = String(selectedTargetMonth);
    function syncTargetMonthHint() {
        targetMonthHint.textContent = '指标与子指标已切换至 ' + selectedTargetMonth + '月数据，同时展示上月 / 本月 / 下月目标';
    }
    syncTargetMonthHint();
    targetMonthSelect.addEventListener('change', async function () {
        const nextMonth = Number(targetMonthSelect.value);
        if (!Number.isInteger(nextMonth) || nextMonth < 1 || nextMonth > 12) return;
        selectedTargetMonth = nextMonth;
        syncTargetMonthHint();
        if (!capturedFiles.length) return;
        if (selectedTaskIndex !== null) {
            const selectedFiles = filesForTask(selectedTaskIndex);
            const monthFileIndex = preferredMetricFileIndex(selectedFiles, selectedTargetMonth);
            if (monthFileIndex >= 0) selectedFileIndex = monthFileIndex;
        }
        await renderMetrics();
        if (selectedTaskIndex !== null) await renderDetail();
    });
    status.textContent = originMatched
        ? '准备就绪：当前页面站点匹配。'
        : '站点不匹配：请在 ' + expectedOrigin + ' 页面运行此脚本。当前为 ' + window.location.origin;
    if (!originMatched) {
        notice.className = 'notice bad';
        notice.textContent = '当前页面与所选站点不匹配，无法开始抓取。';
        status.className = 'status bad';
        startButton.disabled = true;
    }

    function syncHostWidth() {
        const viewportWidth = Math.max(280, Number(document.documentElement.clientWidth) || Number(window.innerWidth) || 1200);
        const viewportHeight = Math.max(320, Number(document.documentElement.clientHeight) || Number(window.innerHeight) || 800);
        const gutter = viewportWidth <= 520 ? 16 : 36;
        const targetWidth = minimized ? 54 : (fullscreen ? viewportWidth - 16 : Math.max(240, Math.min(resultMode ? 1100 : 420, viewportWidth - gutter)));
        const lockedWidth = Math.floor(targetWidth) + 'px';
        host.style.width = lockedWidth;
        host.style.minWidth = lockedWidth;
        host.style.maxWidth = lockedWidth;
        host.style.flexBasis = lockedWidth;
        if (minimized) {
            host.style.top = 'auto'; host.style.right = '18px'; host.style.bottom = '18px'; host.style.left = 'auto';
        } else if (fullscreen) {
            host.style.top = '8px'; host.style.right = '8px'; host.style.bottom = '8px'; host.style.left = '8px';
            panel.style.maxHeight = Math.floor(viewportHeight - 16) + 'px';
            panel.style.height = Math.floor(viewportHeight - 16) + 'px';
            panel.style.borderRadius = '10px';
        } else {
            host.style.top = '18px'; host.style.right = '18px'; host.style.bottom = 'auto'; host.style.left = 'auto';
            panel.style.maxHeight = 'calc(100vh - 36px)';
            panel.style.height = 'auto';
            panel.style.borderRadius = '15px';
        }
    }
    syncHostWidth();
    window.addEventListener('resize', syncHostWidth, { passive: true });

    function parseCsv(text) {
        const rows = [];
        let row = [];
        let cell = '';
        let quoted = false;
        const source = String(text || '').replace(/^\uFEFF/, '');
        for (let index = 0; index < source.length; index++) {
            const char = source[index];
            if (quoted) {
                if (char === '"' && source[index + 1] === '"') { cell += '"'; index++; }
                else if (char === '"') quoted = false;
                else cell += char;
            } else if (char === '"') quoted = true;
            else if (char === ',') { row.push(cell); cell = ''; }
            else if (char === '\\n') { row.push(cell.replace(/\\r$/, '')); rows.push(row); row = []; cell = ''; }
            else cell += char;
        }
        if (cell || row.length) { row.push(cell.replace(/\\r$/, '')); rows.push(row); }
        return rows.filter(function (item) { return item.some(function (value) { return value !== ''; }); });
    }

    function firstRowValue(row, fields) {
        for (const field of fields || []) {
            const value = row && row[field];
            if (value !== undefined && value !== null && String(value).trim() !== '') {
                return { field: field, value: String(value).trim() };
            }
        }
        return { field: '', value: '' };
    }

    function parseRuleDate(value) {
        if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
        if (typeof value === 'number' && Number.isFinite(value)) {
            const numericDate = new Date(value < 100000000000 ? value * 1000 : value);
            return isNaN(numericDate.getTime()) ? null : numericDate;
        }
        const text = String(value || '').trim();
        if (!text) return null;
        if (/^\\d{10,13}$/.test(text)) {
            const timestamp = Number(text);
            const timestampDate = new Date(text.length === 10 ? timestamp * 1000 : timestamp);
            if (!isNaN(timestampDate.getTime())) return timestampDate;
        }
        const normalized = text
            .replace(/[年/]/g, '-')
            .replace(/月/g, '-')
            .replace(/日/g, '')
            .replace(/\\s+/g, ' ');
        const parsed = new Date(normalized);
        return isNaN(parsed.getTime()) ? null : parsed;
    }

    function detectRuleMode(file) {
        const source = String((file && file.taskName) || '') + ' ' + String((file && file.originalName) || (file && file.name) || '');
        const lower = source.toLowerCase();
        if (source.includes('整改详单') || lower.includes('rectification')) return 'rectification';
        if (source.includes('CPT风险详表') || lower.includes('cpt') || lower.includes('special')) return 'special';
        if (source.includes('详单-SR') || source.includes('SR详单') || /(^|[^a-z])sr([^a-z]|$)/i.test(source)) return 'sr';
        if (source.includes('详单漏洞') || source.includes('漏洞预警') || lower.includes('vulnerability')) return 'vulnerability';
        if (source.includes('风险详单') || lower.includes('risk detail')) return 'risk';
        return '';
    }

    function matchRuleValue(actualValue, match) {
        const actual = String(actualValue || '');
        const values = Array.isArray(match && match.values) ? match.values : [];
        const caseSensitive = match && match.caseSensitive === true;
        const candidate = caseSensitive ? actual : actual.toLowerCase();
        return values.some(function (rawValue) {
            const raw = String(rawValue || '');
            const expected = caseSensitive ? raw : raw.toLowerCase();
            if (match && match.operator === 'contains') return candidate.includes(expected);
            if (match && match.operator === 'regex') {
                try { return new RegExp(raw, caseSensitive ? '' : 'i').test(actual); } catch (error) { return false; }
            }
            return candidate === expected;
        });
    }

    function makeAnalysis(severity, judgment, days, reason, matched) {
        return {
            severity: severity || 'normal',
            judgment: judgment || '正常',
            days: Number.isFinite(days) ? days : null,
            reason: reason || '',
            matched: matched !== false
        };
    }

    function evaluateStandardRule(mode, row, config) {
        if (!config || !Array.isArray(config.rules)) return makeAnalysis('normal', '未配置规则', null, '规则快照中没有此类详表配置', false);
        const status = firstRowValue(row, config.statusFields || []).value;
        const rule = config.rules.find(function (item) {
            return item && item.enabled !== false && matchRuleValue(status, item.match || {});
        });
        if (!rule) return makeAnalysis('normal', '正常/未命中', null, status ? '状态未命中启用规则：' + status : '未找到可识别的状态字段', false);
        const dateValue = firstRowValue(row, rule.deadline && rule.deadline.fields || []);
        if (!dateValue.value) return makeAnalysis('info', '缺少截止日期', null, rule.name + ' · 缺少 ' + ((rule.deadline && rule.deadline.fields || []).join(' / ')), true);
        const parsed = parseRuleDate(dateValue.value);
        if (!parsed) return makeAnalysis('info', '日期解析失败', null, dateValue.field + '：' + dateValue.value, true);
        const deadline = new Date(parsed.getTime());
        if (rule.deadline && rule.deadline.type === 'field_plus_days') deadline.setDate(deadline.getDate() + Number(rule.deadline.offsetDays || 0));
        const days = Math.ceil((deadline.getTime() - Date.now()) / 86400000);
        const levels = mode === 'risk' ? config.alertLevels : rule.alertLevels;
        const level = (Array.isArray(levels) ? levels : [])
            .filter(function (item) { return item && item.enabled !== false; })
            .slice()
            .sort(function (a, b) { return Number(a.maxDays) - Number(b.maxDays); })
            .find(function (item) { return days <= Number(item.maxDays); });
        if (!level) return makeAnalysis('normal', '正常', days, rule.name + ' · 距截止还有 ' + days + ' 天', true);
        const severity = ['danger', 'warning', 'info'].includes(level.severity) ? level.severity : 'warning';
        const label = String(rule.badgePrefix || rule.name || '') + String(level.badgeSuffix || level.name || '提醒');
        return makeAnalysis(severity, label, days, rule.name + ' · 距截止还有 ' + days + ' 天', true);
    }

    function containsConfiguredValue(actual, values) {
        const text = String(actual || '').toLowerCase();
        return (Array.isArray(values) ? values : []).some(function (value) { return text.includes(String(value || '').toLowerCase()); });
    }

    function srStyleAnalysis(style, fallbackLabel, days, reason) {
        const enabled = !style || style.enabled !== false;
        const severity = enabled && style && ['danger', 'warning', 'info'].includes(style.severity) ? style.severity : 'normal';
        return makeAnalysis(severity, enabled && style && style.label ? style.label : fallbackLabel, days, reason, true);
    }

    function evaluateSrRule(row, config) {
        if (!config || !config.fields || !config.values) return makeAnalysis('normal', '未配置规则', null, '规则快照中没有 SR 配置', false);
        const value = function (key) { return firstRowValue(row, config.fields[key] || []).value; };
        const status = value('status');
        const severityValue = value('severity');
        const overdueFlag = value('overdue');
        const parse = function (key) { const raw = value(key); return raw ? parseRuleDate(raw) : null; };
        const open = parse('openDate');
        const expected = parse('expectedClose');
        const suspended = parse('suspendedClose');
        const actual = parse('actualClose');
        const isPending = containsConfiguredValue(status, config.values.pending);
        const isClosed = containsConfiguredValue(status, config.values.closed);
        const isCritical = containsConfiguredValue(severityValue, config.values.critical);
        const upstreamOverdue = (config.values.overdue || []).some(function (item) { return String(item).toLowerCase() === String(overdueFlag).toLowerCase(); });
        const alerts = config.alerts || {};
        const thresholds = config.thresholds || {};
        if (isPending) return srStyleAnalysis(alerts.pending, '挂起忽略', null, 'SR 当前为挂起状态：' + status);
        if (isClosed) {
            if ((actual && expected && actual > expected) || upstreamOverdue) {
                if (suspended && actual && actual <= suspended) return srStyleAnalysis(alerts.suspendedGood, '挂起后未超期', null, '实际关单未超过挂起后期限');
                const reference = suspended || expected;
                const overdueHours = actual && reference ? Math.ceil((actual - reference) / 3600000) : null;
                return srStyleAnalysis(suspended ? alerts.suspendedOverdue : alerts.historicalOverdue, suspended ? '挂起后超期' : '历史超期', -1, overdueHours && overdueHours > 0 ? '实际关单超期 ' + overdueHours + ' 小时' : '已触发上游超期标识');
            }
            return srStyleAnalysis(alerts.closed, '已关单', null, 'SR 已正常关闭');
        }
        if (!open || !expected) return makeAnalysis('info', '缺少 SLA 关键时间', null, '缺少开单时间或期望关单时间', true);
        const deadline = suspended || expected;
        const total = deadline.getTime() - open.getTime();
        const remaining = deadline.getTime() - Date.now();
        const remainingHours = Math.ceil(remaining / 3600000);
        const remainingDays = Math.ceil(remaining / 86400000);
        const consume = total > 0 ? ((Date.now() - open.getTime()) / total) * 100 : 100;
        const reason = '剩余 ' + remainingHours + ' 小时 · 已消耗 ' + (Number.isFinite(consume) ? consume.toFixed(0) : 100) + '%';
        if (remaining < 0 || upstreamOverdue) return srStyleAnalysis(alerts.overdue, 'SR超期', remainingDays, reason);
        if (isCritical && (consume > Number(thresholds.criticalDangerConsume) || remainingHours < Number(thresholds.criticalDangerHours))) return srStyleAnalysis(alerts.criticalDanger, 'Critical高危', remainingDays, reason);
        if (isCritical && consume > Number(thresholds.criticalWarningConsume) && remainingHours < Number(thresholds.criticalWarningHours)) return srStyleAnalysis(alerts.criticalWarning, 'Critical预警', remainingDays, reason);
        if (!isCritical && consume > Number(thresholds.normalDangerConsume)) return srStyleAnalysis(alerts.normalDanger, 'SR高危', remainingDays, reason);
        if (!isCritical && consume > Number(thresholds.normalWarningConsume)) return srStyleAnalysis(alerts.normalWarning, 'SR预警', remainingDays, reason);
        return makeAnalysis('normal', '正常', remainingDays, reason, true);
    }

    function normalizeMetricFileName(value) {
        return String(value || '')
            .replace(/^.*[\\\\/]/, '')
            .replace(/\\.csv$/i, '')
            .replace(/\\s*\\(\\d+\\)$/i, '')
            .replace(/_?\\d{4}年\\d{1,2}月(?:\\d{1,2}日)?$/i, '')
            .trim()
            .toLowerCase();
    }

    function findMetricSchema(file) {
        const fileNames = [file.originalName, file.name, file.taskName].map(normalizeMetricFileName).filter(Boolean);
        let best = null;
        let bestScore = 0;
        (ruleBundle.metricSchemas || []).forEach(function (schema) {
            const meta = schema && schema.sourceMeta || {};
            const candidates = []
                .concat(meta.sourceFiles || [])
                .concat([meta.baseName, String(meta.matchedPrefix || '').replace(/\\*+$/, '')])
                .map(normalizeMetricFileName)
                .filter(Boolean);
            candidates.forEach(function (candidate) {
                fileNames.forEach(function (fileName) {
                    const exact = fileName === candidate;
                    const partial = fileName.includes(candidate) || candidate.includes(fileName);
                    const score = exact ? 10000 + candidate.length : (partial ? candidate.length : 0);
                    if (score > bestScore) { best = schema; bestScore = score; }
                });
            });
        });
        return best;
    }

    function metricCellMatches(value, pattern) {
        const text = value === undefined || value === null ? '' : String(value).trim();
        const expected = pattern === undefined || pattern === null ? '' : String(pattern);
        if (expected === '[空]') return text === '';
        if (expected === '[非空]') return text !== '';
        return text.includes(expected);
    }

    function metricRowMatches(row, rule) {
        if (rule.colX && !metricCellMatches(row[rule.colX], rule.valY)) return false;
        return (Array.isArray(rule.conditions) ? rule.conditions : []).every(function (condition) {
            return condition && condition.column && metricCellMatches(row[condition.column], condition.value);
        });
    }

    function evaluateMetricRule(rule, rows) {
        const matchedRows = rows.filter(function (row) { return metricRowMatches(row, rule); });
        if (rule.type === 'count') {
            return matchedRows.filter(function (row) { return metricCellMatches(row[rule.colZ], rule.valK); }).length;
        }
        if (rule.type === 'ratio') {
            const matched = matchedRows.filter(function (row) { return metricCellMatches(row[rule.colZ], rule.valK); }).length;
            return matchedRows.length ? Math.round((matched / matchedRows.length) * 100) + '%' : '0%';
        }
        const row = matchedRows[0];
        return row && row[rule.colZ] !== undefined && row[rule.colZ] !== null ? row[rule.colZ] : '--';
    }

    function defaultTargetMonth() {
        const now = new Date();
        if (now.getDate() >= 10) return now.getMonth() + 1;
        return now.getMonth() === 0 ? 12 : now.getMonth();
    }

    function offsetTargetMonth(month, offset) {
        return ((Number(month) - 1 + Number(offset) + 120) % 12) + 1;
    }

    function formatTargetValue(target, month) {
        if (!target || target[month] === undefined || target[month] === null || target[month] === '') return '—';
        const raw = String(target[month]);
        const value = target.isPercent === true && !raw.endsWith('%') ? raw + '%' : raw;
        return (target.type || 'gte') === 'lte' ? '≤ ' + value : '≥ ' + value;
    }

    function buildTargetWindow(target) {
        return [
            { key: 'previous', label: '上月', month: offsetTargetMonth(selectedTargetMonth, -1) },
            { key: 'current', label: '本月', month: selectedTargetMonth },
            { key: 'next', label: '下月', month: offsetTargetMonth(selectedTargetMonth, 1) }
        ].map(function (item) {
            return { key: item.key, label: item.label, month: item.month, value: formatTargetValue(target, item.month) };
        });
    }

    function metricTargetDefinition(schema, rule, fallbackRule) {
        const secId = schema && schema.sourceMeta && schema.sourceMeta.secId;
        if (!secId || !ruleBundle.targets) return null;
        return (rule && rule.id && ruleBundle.targets[secId + '_' + rule.id])
            || (fallbackRule && fallbackRule.id && ruleBundle.targets[secId + '_' + fallbackRule.id])
            || null;
    }

    function shouldAutoPercentMetric(label, column) {
        const text = (String(label || '') + ' ' + String(column || '')).toLowerCase();
        return text.includes('率')
            || text.includes('占比')
            || /(^|[_\\s-])(rate|ratio|percent|percentage|pct)($|[_\\s-])/.test(text)
            || /(rate|ratio|percent|percentage|pct)$/i.test(String(column || ''));
    }

    function formatMetricValue(value, target, autoPercent, ruleType) {
        if (value === '--' || ruleType === 'count' || ruleType === 'ratio') return value;
        const text = String(value).trim();
        if (target && target.isPercent === false && text.endsWith('%')) return text.replace(/%$/, '');
        const usePercent = target && target.isPercent !== undefined ? target.isPercent : autoPercent;
        if (!usePercent) return value;
        const alreadyPercent = text.endsWith('%');
        const number = parseFloat(text);
        if (!Number.isFinite(number)) return value;
        return Math.round(alreadyPercent ? number : number * 100) + '%';
    }

    function judgeMetricTarget(target, value) {
        if (!target) return { warning: false, gap: '' };
        const targetValue = Number(target[selectedTargetMonth]);
        const valueText = String(value).trim();
        if (!valueText || valueText === '--' || valueText.includes('缺少')) return { warning: false, gap: '' };
        const actualText = valueText.replace(/[^0-9.-]/g, '');
        const actual = actualText ? Number(actualText) : NaN;
        if (!Number.isFinite(targetValue) || !Number.isFinite(actual)) return { warning: false, gap: '' };
        const isLessThanTarget = (target.type || 'gte') === 'gte' && actual < targetValue;
        const isGreaterThanTarget = target.type === 'lte' && actual > targetValue;
        if (!isLessThanTarget && !isGreaterThanTarget) return { warning: false, gap: '' };
        const gap = Math.abs(targetValue - actual).toFixed(2).replace(/\\.00$/, '');
        return { warning: true, gap: (isLessThanTarget ? '距目标差 ' : '超过目标 ') + gap + (String(value).includes('%') ? '%' : '') };
    }

    function metricFilePeriod(file) {
        const names = [file && file.originalName, file && file.name].filter(Boolean);
        for (const name of names) {
            const match = String(name).match(/(?:_|-)\\s*(\\d{4})年(\\d{1,2})月(?:\\d{1,2}日)?(?:\\.csv)?$/i);
            if (match) return { year: Number(match[1]), month: Number(match[2]), label: match[1] + '年' + Number(match[2]) + '月' };
        }
        return null;
    }

    function selectMetricFilesForMonth(files, month) {
        const candidates = (files || []).map(function (file) { return { file: file, period: metricFilePeriod(file) }; });
        const periodCandidates = candidates.filter(function (item) { return !!item.period; });
        if (periodCandidates.length) {
            const matching = periodCandidates.filter(function (item) { return item.period.month === Number(month); });
            if (!matching.length) return { files: [], found: false, monthMissing: true, periodLabel: Number(month) + '月数据缺失' };
            const latestYear = Math.max.apply(null, matching.map(function (item) { return item.period.year; }));
            const selected = matching.filter(function (item) { return item.period.year === latestYear; });
            return { files: selected.map(function (item) { return item.file; }), found: true, monthMissing: false, periodLabel: latestYear + '年' + Number(month) + '月' };
        }
        return { files: candidates.map(function (item) { return item.file; }), found: candidates.length > 0, monthMissing: false, periodLabel: candidates.length ? 'Latest 数据' : '' };
    }

    function preferredMetricFileIndex(files, month) {
        let bestIndex = -1;
        let bestYear = -1;
        (files || []).forEach(function (file, index) {
            const period = metricFilePeriod(file);
            if (period && period.month === Number(month) && period.year > bestYear) { bestIndex = index; bestYear = period.year; }
        });
        return bestIndex;
    }

    function dataForMetricSource(sourceSecId, currentSchema, currentRows, currentFile) {
        const currentSecId = currentSchema && currentSchema.sourceMeta && currentSchema.sourceMeta.secId;
        const targetSecId = sourceSecId || currentSecId;
        if (!targetSecId) return { rows: currentRows, found: true, monthMissing: false, periodLabel: 'Latest 数据' };
        const sourceFiles = capturedFiles.filter(function (candidate) {
            const schema = candidate.metricSchema || findMetricSchema(candidate);
            return schema && schema.sourceMeta && schema.sourceMeta.secId === targetSecId && Array.isArray(candidate.rowObjects);
        });
        if (!sourceFiles.length && targetSecId === currentSecId) {
            const fallbackSelection = selectMetricFilesForMonth(currentFile ? [currentFile] : [], selectedTargetMonth);
            if (fallbackSelection.found) return { rows: currentRows, found: true, monthMissing: false, periodLabel: fallbackSelection.periodLabel };
            return { rows: [], found: false, monthMissing: fallbackSelection.monthMissing, periodLabel: fallbackSelection.periodLabel };
        }
        const selection = selectMetricFilesForMonth(sourceFiles, selectedTargetMonth);
        return {
            rows: selection.files.flatMap(function (sourceFile) { return sourceFile.rowObjects || []; }),
            found: selection.found,
            monthMissing: selection.monthMissing,
            periodLabel: selection.periodLabel
        };
    }

    function evaluateDerivedMetrics(file) {
        const schema = file.metricSchema || findMetricSchema(file);
        file.metricSchema = schema || null;
        const rowObjects = file.rowObjects || [];
        file.derivedMetrics = !schema ? [] : (schema.customMetrics || []).map(function (rule) {
            const parentTarget = metricTargetDefinition(schema, rule);
            const mainSource = dataForMetricSource(rule.sourceSecId, schema, rowObjects, file);
            let value = mainSource.found ? evaluateMetricRule(rule, mainSource.rows) : (mainSource.monthMissing ? '缺少 ' + selectedTargetMonth + ' 月来源表' : '--');
            value = formatMetricValue(value, parentTarget, shouldAutoPercentMetric(rule.label, rule.colZ), rule.type);
            const target = judgeMetricTarget(parentTarget, value);
            const subMetrics = (rule.subMetrics || []).map(function (subRule) {
                const subTarget = metricTargetDefinition(schema, subRule, rule);
                const sourceData = dataForMetricSource(subRule.sourceSecId, schema, rowObjects, file);
                let subValue = sourceData.found ? evaluateMetricRule(subRule, sourceData.rows) : (sourceData.monthMissing ? '缺少 ' + selectedTargetMonth + ' 月来源表' : '缺少来源表');
                subValue = formatMetricValue(
                    subValue,
                    subTarget,
                    shouldAutoPercentMetric(subRule.label || rule.label, subRule.colZ || rule.colZ),
                    subRule.type
                );
                const subJudgment = judgeMetricTarget(subTarget, subValue);
                return { label: subRule.category || subRule.label || '子指标', value: subValue, warning: subJudgment.warning, gap: subJudgment.gap, sourceMissing: !sourceData.found, sourceLabel: sourceData.periodLabel };
            });
            return {
                id: rule.id,
                label: rule.label || rule.colZ || '未命名指标',
                value: value,
                warning: target.warning,
                gap: target.gap,
                sourceMissing: !mainSource.found,
                sourceLabel: mainSource.periodLabel,
                targetMonth: selectedTargetMonth,
                targetWindow: buildTargetWindow(parentTarget),
                subMetrics: subMetrics
            };
        });
    }

    function analyzeRows(file) {
        const rows = file.rows || [];
        const headers = rows[0] || [];
        file.ruleMode = detectRuleMode(file);
        file.ruleLabel = { risk: '常规风险', rectification: '整改详单', special: 'CPT专项风险', sr: 'SR详单', vulnerability: '漏洞预警' }[file.ruleMode] || '';
        const rowObjects = rows.slice(1).map(function (values) {
            const row = {};
            headers.forEach(function (header, index) { row[header] = values[index]; });
            return row;
        });
        file.rowObjects = rowObjects;
        file.analyses = rowObjects.map(function (row) {
            if (!file.ruleMode) return makeAnalysis('normal', '未识别规则类型', null, '保留原始数据，未执行 SLA 判断', false);
            const config = ruleBundle.builtin && ruleBundle.builtin[file.ruleMode];
            return file.ruleMode === 'sr' ? evaluateSrRule(row, config) : evaluateStandardRule(file.ruleMode, row, config);
        });
        file.analysisCounts = file.analyses.reduce(function (counts, item) {
            const key = ['danger', 'warning', 'info'].includes(item.severity) ? item.severity : 'normal';
            counts[key]++;
            return counts;
        }, { danger: 0, warning: 0, info: 0, normal: 0 });
        evaluateDerivedMetrics(file);
    }

    async function prepareFile(file) {
        if (!file.parsedPromise) {
            file.parsedPromise = file.blob.text().then(function (text) {
                file.rows = parseCsv(text);
                file.rowCount = Math.max(0, file.rows.length - 1);
                analyzeRows(file);
                return file;
            });
        }
        return file.parsedPromise;
    }

    function filesForTask(taskIndex) {
        return capturedFiles.filter(function (file) { return file.taskIndex === taskIndex; });
    }

    function makeCell(tag, text) {
        const cell = document.createElement(tag);
        cell.textContent = text === undefined || text === null ? '' : String(text);
        cell.title = cell.textContent;
        return cell;
    }

    function detailMetricRules(file) {
        const schema = file.metricSchema || findMetricSchema(file);
        const secId = schema && schema.sourceMeta && schema.sourceMeta.secId;
        if (!secId) return [];
        const collected = [];
        const identities = new Set();
        function add(rule, label) {
            if (!rule || typeof rule !== 'object') return;
            const identity = [rule.id || '', label || '', rule.colX || '', rule.colZ || '', rule.sourceSecId || ''].join('|');
            if (identities.has(identity)) return;
            identities.add(identity);
            collected.push({ rule: rule, label: label || rule.label || rule.colZ || '关联指标' });
        }
        (ruleBundle.metricSchemas || []).forEach(function (ownerSchema) {
            const ownerSecId = ownerSchema && ownerSchema.sourceMeta && ownerSchema.sourceMeta.secId;
            (ownerSchema.customMetrics || []).forEach(function (metric) {
                const metricLabel = metric.label || metric.colZ || '未命名指标';
                if ((!metric.sourceSecId && ownerSecId === secId) || metric.sourceSecId === secId) add(metric, metricLabel);
                (metric.subMetrics || []).forEach(function (subMetric) {
                    const sourceSecId = subMetric.sourceSecId || ownerSecId;
                    if (sourceSecId === secId) add(subMetric, metricLabel + ' / ' + (subMetric.category || subMetric.label || '子指标'));
                });
            });
        });
        return collected;
    }

    function detailColumnLayout(file, headers) {
        const outputFields = new Set();
        const ruleFields = new Set();
        const metricRules = detailMetricRules(file);
        metricRules.forEach(function (item) {
            const rule = item.rule;
            if (rule.colZ) outputFields.add(rule.colZ);
            if (rule.colX) ruleFields.add(rule.colX);
            (rule.conditions || []).forEach(function (condition) { if (condition && condition.column) ruleFields.add(condition.column); });
        });
        const builtin = ruleBundle.builtin && ruleBundle.builtin[file.ruleMode];
        if (builtin) {
            if (file.ruleMode === 'sr') {
                Object.values(builtin.fields || {}).forEach(function (fields) { (fields || []).forEach(function (field) { ruleFields.add(field); }); });
            } else {
                (builtin.statusFields || []).forEach(function (field) { ruleFields.add(field); });
                (builtin.rules || []).forEach(function (rule) {
                    (rule.deadline && rule.deadline.fields || []).forEach(function (field) { ruleFields.add(field); });
                });
            }
        }
        outputFields.forEach(function (field) { ruleFields.delete(field); });
        const columns = headers.map(function (header, index) {
            return { header: header, index: index, role: outputFields.has(header) ? 'output' : (ruleFields.has(header) ? 'rule' : 'normal') };
        }).sort(function (left, right) {
            const rank = { output: 0, rule: 1, normal: 2 };
            return rank[left.role] - rank[right.role] || left.index - right.index;
        });
        return { columns: columns, metricRules: metricRules };
    }

    function matchedDetailMetrics(row, metricRules) {
        return Array.from(new Set((metricRules || [])
            .filter(function (item) { return metricRowMatches(row, item.rule); })
            .map(function (item) { return item.label; })))
            .join(' · ');
    }

    function resetDetailSort() {
        detailSortKey = 'auto';
        detailSortDirection = 'asc';
    }

    function detailComparableValue(value) {
        if (value === undefined || value === null || String(value).trim() === '') return { empty: true, value: '' };
        const text = String(value).trim();
        const numericText = text.replace(/,/g, '').replace(/%$/, '');
        if (/^-?\\d+(?:\\.\\d+)?%?$/.test(numericText)) return { empty: false, value: Number(numericText) };
        if (/\\d{4}[\\-/年]\\d{1,2}/.test(text)) {
            const date = parseRuleDate(text);
            if (date) return { empty: false, value: date.getTime() };
        }
        return { empty: false, value: text.toLocaleLowerCase() };
    }

    function compareDetailValues(leftValue, rightValue, direction) {
        const left = detailComparableValue(leftValue);
        const right = detailComparableValue(rightValue);
        if (left.empty !== right.empty) return left.empty ? 1 : -1;
        if (left.empty) return 0;
        let result = 0;
        if (typeof left.value === 'number' && typeof right.value === 'number') result = left.value - right.value;
        else result = String(left.value).localeCompare(String(right.value), 'zh-CN', { numeric: true, sensitivity: 'base' });
        return direction === 'desc' ? -result : result;
    }

    function autoDetailRowCompare(left, right) {
        const leftRelated = left.association || (left.analysis && left.analysis.matched) ? 0 : 1;
        const rightRelated = right.association || (right.analysis && right.analysis.matched) ? 0 : 1;
        if (leftRelated !== rightRelated) return leftRelated - rightRelated;
        const severityRank = { danger: 0, warning: 1, info: 2, normal: 3 };
        const leftSeverity = severityRank[left.analysis && left.analysis.severity] === undefined ? 3 : severityRank[left.analysis.severity];
        const rightSeverity = severityRank[right.analysis && right.analysis.severity] === undefined ? 3 : severityRank[right.analysis.severity];
        if (leftSeverity !== rightSeverity) return leftSeverity - rightSeverity;
        const leftDays = left.analysis && Number.isFinite(left.analysis.days) ? left.analysis.days : Number.POSITIVE_INFINITY;
        const rightDays = right.analysis && Number.isFinite(right.analysis.days) ? right.analysis.days : Number.POSITIVE_INFINITY;
        if (leftDays !== rightDays) return leftDays - rightDays;
        return left.originalIndex - right.originalIndex;
    }

    function detailRowSortValue(item, key) {
        if (key === 'judgment') {
            const rank = { danger: 0, warning: 1, info: 2, normal: 3 };
            return rank[item.analysis && item.analysis.severity] === undefined ? 3 : rank[item.analysis.severity];
        }
        if (key === 'days') return item.analysis && item.analysis.days;
        if (key === 'reason') return item.analysis && item.analysis.reason;
        if (key === 'association') return item.association;
        if (key.startsWith('column:')) return item.values[Number(key.slice(7))];
        return '';
    }

    function sortDetailRows(rows) {
        const sorted = rows.slice();
        if (detailSortKey === 'auto') return sorted.sort(autoDetailRowCompare);
        return sorted.sort(function (left, right) {
            const compared = compareDetailValues(detailRowSortValue(left, detailSortKey), detailRowSortValue(right, detailSortKey), detailSortDirection);
            return compared || left.originalIndex - right.originalIndex;
        });
    }

    function makeSortableDetailHeader(cell, key, label) {
        cell.classList.add('sortable');
        cell.tabIndex = 0;
        cell.setAttribute('role', 'button');
        cell.setAttribute('aria-sort', detailSortKey === key ? (detailSortDirection === 'asc' ? 'ascending' : 'descending') : 'none');
        if (detailSortKey === key) cell.classList.add(detailSortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
        const activate = function () {
            if (detailSortKey === key) detailSortDirection = detailSortDirection === 'asc' ? 'desc' : 'asc';
            else { detailSortKey = key; detailSortDirection = 'asc'; }
            currentPage = 1;
            renderDetail();
        };
        cell.title = label + '：点击' + (detailSortKey === key ? '切换为' + (detailSortDirection === 'asc' ? '降序' : '升序') : '升序排列');
        cell.addEventListener('click', activate);
        cell.addEventListener('keydown', function (event) {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            activate();
        });
    }

    async function renderDetail() {
        const task = taskMeta.find(function (item) { return item.index === selectedTaskIndex; });
        const files = filesForTask(selectedTaskIndex);
        detail.style.display = 'block';
        detailTitle.textContent = task ? task.name : '指标详表';
        rerunOneButton.disabled = !task || !taskRunners.has(task.index) || captureActive;
        fileTabs.innerHTML = '';
        derivedMetrics.innerHTML = '';
        derivedMetrics.style.display = 'none';
        analysisFilters.innerHTML = '';
        analysisFilters.style.display = 'none';
        tableWrap.innerHTML = '';
        if (!files.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-detail';
            empty.textContent = '该指标本次未生成 CSV 数据。';
            tableWrap.appendChild(empty);
            pageInfo.textContent = '';
            prevButton.disabled = true;
            nextButton.disabled = true;
            return;
        }
        selectedFileIndex = Math.min(selectedFileIndex, files.length - 1);
        files.forEach(function (file, index) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'file-tab' + (index === selectedFileIndex ? ' active' : '');
            button.textContent = file.name;
            button.title = file.name;
            button.addEventListener('click', function () { selectedFileIndex = index; selectedRiskFilter = 'all'; resetDetailSort(); currentPage = 1; renderDetail(); });
            fileTabs.appendChild(button);
        });
        const file = await prepareFile(files[selectedFileIndex]);
        evaluateDerivedMetrics(file);
        if (file.derivedMetrics && file.derivedMetrics.length) {
            derivedMetrics.style.display = 'flex';
            file.derivedMetrics.forEach(function (metric) {
                const chip = document.createElement('div');
                const hasSubWarning = (metric.subMetrics || []).some(function (item) { return item.warning || item.sourceMissing; });
                chip.className = 'derived-chip' + (metric.warning || metric.sourceMissing || hasSubWarning ? ' warn' : '');
                const label = document.createElement('span');
                label.className = 'derived-label';
                label.textContent = metric.label;
                label.title = metric.label;
                const period = document.createElement('span');
                period.className = 'derived-period';
                period.textContent = '数据口径：' + (metric.sourceLabel || selectedTargetMonth + '月');
                const value = document.createElement('span');
                value.className = 'derived-value';
                value.textContent = metric.value;
                value.title = String(metric.value);
                chip.appendChild(label);
                chip.appendChild(period);
                chip.appendChild(value);
                if (metric.gap) {
                    const gap = document.createElement('span');
                    gap.className = 'derived-gap';
                    gap.textContent = metric.gap;
                    chip.appendChild(gap);
                }
                if (metric.targetWindow && metric.targetWindow.length) {
                    const targetWindow = document.createElement('div');
                    targetWindow.className = 'metric-target-window';
                    metric.targetWindow.forEach(function (targetItem) {
                        const item = document.createElement('div');
                        item.className = 'metric-target-item' + (targetItem.key === 'current' ? ' current' : '');
                        const targetLabel = document.createElement('span');
                        targetLabel.className = 'metric-target-label';
                        targetLabel.textContent = targetItem.label + ' ' + targetItem.month + '月';
                        const targetValue = document.createElement('span');
                        targetValue.className = 'metric-target-value';
                        targetValue.textContent = targetItem.value;
                        item.appendChild(targetLabel);
                        item.appendChild(targetValue);
                        targetWindow.appendChild(item);
                    });
                    chip.appendChild(targetWindow);
                }
                if (metric.subMetrics && metric.subMetrics.length) {
                    const subList = document.createElement('div');
                    subList.className = 'derived-subs';
                    metric.subMetrics.forEach(function (item) {
                        const sub = document.createElement('div');
                        sub.className = 'derived-sub' + (item.sourceMissing ? ' missing' : '') + (item.warning ? ' warn' : '');
                        sub.title = (item.sourceLabel ? '数据口径：' + item.sourceLabel : '') + (item.gap ? ' · ' + item.gap : '');
                        const subLabel = document.createElement('span');
                        subLabel.className = 'derived-sub-label';
                        subLabel.textContent = item.label;
                        subLabel.title = item.label;
                        const subValue = document.createElement('span');
                        subValue.className = 'derived-sub-value';
                        subValue.textContent = item.value;
                        subValue.title = String(item.value);
                        sub.appendChild(subLabel);
                        sub.appendChild(subValue);
                        if (item.gap) {
                            const subGap = document.createElement('span');
                            subGap.className = 'derived-sub-gap';
                            subGap.textContent = item.gap;
                            sub.appendChild(subGap);
                        }
                        subList.appendChild(sub);
                    });
                    chip.appendChild(subList);
                }
                derivedMetrics.appendChild(chip);
            });
        }
        const rows = file.rows || [];
        if (!rows.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-detail';
            empty.textContent = 'CSV 文件为空。';
            tableWrap.appendChild(empty);
            return;
        }
        const headers = rows[0];
        const dataRows = rows.slice(1);
        const columnLayout = detailColumnLayout(file, headers);
        const showMetricAssociations = columnLayout.metricRules.length > 0;
        const analyses = file.analyses || [];
        const counts = file.analysisCounts || { danger: 0, warning: 0, info: 0, normal: dataRows.length };
        if (file.ruleMode) {
            analysisFilters.style.display = 'flex';
            [
                ['all', '全部 ' + dataRows.length],
                ['danger', '红色 ' + counts.danger],
                ['warning', '提醒 ' + counts.warning],
                ['info', '提示 ' + counts.info],
                ['normal', '正常 ' + counts.normal]
            ].forEach(function (filter) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'analysis-filter' + (selectedRiskFilter === filter[0] ? ' active' : '');
                button.textContent = filter[1];
                button.addEventListener('click', function () {
                    selectedRiskFilter = filter[0];
                    currentPage = 1;
                    renderDetail();
                });
                analysisFilters.appendChild(button);
            });
        }
        const indexedRows = dataRows.map(function (values, index) {
            const rowObject = file.rowObjects && file.rowObjects[index] || {};
            return {
                originalIndex: index,
                values: values,
                rowObject: rowObject,
                association: showMetricAssociations ? matchedDetailMetrics(rowObject, columnLayout.metricRules) : '',
                analysis: analyses[index] || makeAnalysis('normal', '正常', null, '', false)
            };
        });
        const filteredRows = selectedRiskFilter === 'all' || !file.ruleMode
            ? indexedRows
            : indexedRows.filter(function (item) { return item.analysis.severity === selectedRiskFilter; });
        const sortedRows = sortDetailRows(filteredRows);
        const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
        currentPage = Math.min(Math.max(1, currentPage), totalPages);
        const start = (currentPage - 1) * pageSize;
        const table = document.createElement('table');
        table.className = 'data-table';
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        if (file.ruleMode) [['规则判断', 'judgment'], ['剩余天数', 'days'], ['判断原因', 'reason']].forEach(function (header) {
            const cell = makeCell('th', header[0]);
            cell.className = 'column-analysis';
            makeSortableDetailHeader(cell, header[1], header[0]);
            headerRow.appendChild(cell);
        });
        if (showMetricAssociations) {
            const associationHeader = makeCell('th', '关联指标');
            associationHeader.className = 'column-association';
            associationHeader.title = '该行命中的主指标或客户群子指标';
            makeSortableDetailHeader(associationHeader, 'association', '关联指标');
            headerRow.appendChild(associationHeader);
        }
        columnLayout.columns.forEach(function (column) {
            const cell = makeCell('th', column.header);
            if (column.role === 'output') { cell.className = 'column-output'; cell.title = '指标输出字段：' + column.header; }
            else if (column.role === 'rule') { cell.className = 'column-rule'; cell.title = '规则匹配字段：' + column.header; }
            makeSortableDetailHeader(cell, 'column:' + column.index, column.header);
            headerRow.appendChild(cell);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        sortedRows.slice(start, start + pageSize).forEach(function (item) {
            const values = item.values;
            const analysis = item.analysis;
            const tr = document.createElement('tr');
            if (file.ruleMode) {
                tr.className = 'risk-' + analysis.severity;
                const judgmentCell = makeCell('td', analysis.judgment);
                judgmentCell.className = 'column-analysis judgment-' + analysis.severity;
                tr.appendChild(judgmentCell);
                const daysCell = makeCell('td', analysis.days === null ? '—' : analysis.days);
                daysCell.className = 'column-analysis';
                const reasonCell = makeCell('td', analysis.reason);
                reasonCell.className = 'column-analysis';
                tr.appendChild(daysCell);
                tr.appendChild(reasonCell);
            }
            if (showMetricAssociations) {
                const associationCell = makeCell('td', item.association || '—');
                associationCell.className = 'column-association';
                tr.appendChild(associationCell);
            }
            columnLayout.columns.forEach(function (column) {
                const cell = makeCell('td', values[column.index]);
                if (column.role === 'output') cell.className = 'column-output';
                else if (column.role === 'rule') cell.className = 'column-rule';
                tr.appendChild(cell);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        const sortText = detailSortKey === 'auto' ? '自动：相关/紧急优先' : '手动：' + (detailSortDirection === 'asc' ? '升序' : '降序');
        pageInfo.textContent = sortText + ' · 第 ' + currentPage + '/' + totalPages + ' 页 · 当前 ' + sortedRows.length + ' / 全部 ' + dataRows.length + ' 行';
        prevButton.disabled = currentPage <= 1;
        nextButton.disabled = currentPage >= totalPages;
    }

    function uniqueTaskDerivedMetrics(files) {
        const unique = new Map();
        (files || []).forEach(function (file) {
            const schema = file.metricSchema || findMetricSchema(file);
            const secId = schema && schema.sourceMeta && schema.sourceMeta.secId || normalizeMetricFileName(file.taskName || file.originalName || file.name);
            (file.derivedMetrics || []).forEach(function (metric) {
                const key = secId + '|' + (metric.id || metric.label);
                if (!unique.has(key)) unique.set(key, metric);
            });
        });
        return Array.from(unique.values());
    }

    async function renderMetrics() {
        resultMode = true;
        syncHostWidth();
        results.style.display = 'block';
        metrics.innerHTML = '';
        await Promise.all(capturedFiles.map(prepareFile));
        capturedFiles.forEach(evaluateDerivedMetrics);
        const totalRows = capturedFiles.reduce(function (sum, file) { return sum + (file.rowCount || 0); }, 0);
        resultSummary.textContent = capturedFiles.length + ' 个 CSV · ' + totalRows + ' 行数据';
        taskMeta.forEach(function (task) {
            const files = filesForTask(task.index);
            const rows = files.reduce(function (sum, file) { return sum + (file.rowCount || 0); }, 0);
            const counts = files.reduce(function (total, file) {
                const item = file.analysisCounts || {};
                total.danger += item.danger || 0;
                total.warning += item.warning || 0;
                total.info += item.info || 0;
                total.normal += item.normal || 0;
                return total;
            }, { danger: 0, warning: 0, info: 0, normal: 0 });
            const hasRecognizedRules = files.some(function (file) { return !!file.ruleMode; });
            const taskDerivedMetrics = uniqueTaskDerivedMetrics(files);
            const derivedCount = taskDerivedMetrics.length;
            const derivedWarnings = taskDerivedMetrics.reduce(function (sum, metric) {
                return sum + (metric.warning ? 1 : 0) + (metric.subMetrics || []).filter(function (subMetric) { return subMetric.warning; }).length;
            }, 0);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'metric' + (files.length ? '' : ' empty') + (counts.danger ? ' has-danger' : '') + (!counts.danger && counts.warning ? ' has-warning' : '') + (derivedWarnings ? ' has-kpi-warning' : '') + (selectedTaskIndex === task.index ? ' active' : '');
            const name = document.createElement('span');
            name.className = 'metric-name';
            name.textContent = task.name;
            name.title = task.name;
            const meta = document.createElement('span');
            meta.className = 'metric-meta';
            meta.textContent = files.length ? (rows + ' 行 · ' + files.length + ' 文件') : (taskStates.get(task.index) === 'done' ? '无 CSV 数据' : '未完成');
            button.appendChild(name);
            button.appendChild(meta);
            if (files.length) {
                const risk = document.createElement('span');
                risk.className = 'metric-risk';
                if (hasRecognizedRules) {
                    risk.innerHTML = '<span class="danger">红 ' + counts.danger + '</span> · <span class="warning">提醒 ' + counts.warning + '</span> · <span class="info">提示 ' + counts.info + '</span> · <span class="normal">正常 ' + counts.normal + '</span>';
                    if (derivedCount) risk.innerHTML += ' · KPI ' + derivedCount + (derivedWarnings ? ' / 未达标 ' + derivedWarnings : '');
                } else if (derivedCount) {
                    risk.textContent = '规则指标 ' + derivedCount + (derivedWarnings ? ' · 未达标 ' + derivedWarnings : ' · 当前达标');
                } else {
                    risk.textContent = '未识别对应的内置规则';
                }
                button.appendChild(risk);
            }
            button.addEventListener('click', function () {
                selectedTaskIndex = task.index;
                selectedFileIndex = 0;
                selectedRiskFilter = 'all';
                resetDetailSort();
                currentPage = 1;
                renderMetrics().then(renderDetail);
            });
            metrics.appendChild(button);
        });
        zipButton.style.display = capturedFiles.length ? 'block' : 'none';
    }

    function setTaskState(task, nextState) {
        if (!task) return;
        taskStates.set(task.index, nextState);
        const finished = Array.from(taskStates.values()).filter(function (value) { return value === 'done'; }).length;
        status.textContent = '正在抓取：' + task.name + ' · 已完成 ' + finished + '/' + taskMeta.length;
    }

    const nativeCreateObjectURL = URL.createObjectURL.bind(URL);
    const nativeRevokeObjectURL = URL.revokeObjectURL.bind(URL);
    const nativeAnchorClick = HTMLAnchorElement.prototype.click;
    const blobByUrl = new Map();

    function blockPageKeyboard(event) {
        if (!captureActive) return;
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        if (path.includes(host)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    function showShieldMessage() {
        if (!controlShieldHost || !controlShieldHost.shadowRoot) return;
        const message = controlShieldHost.shadowRoot.querySelector('.shield-message');
        if (!message) return;
        message.classList.remove('show');
        void message.offsetWidth;
        message.classList.add('show');
        clearTimeout(shieldToastTimer);
        shieldToastTimer = setTimeout(function () { message.classList.remove('show'); }, 2200);
    }

    function installControlShield() {
        if (controlShieldHost && controlShieldHost.isConnected) return;
        controlShieldHost = document.createElement('div');
        controlShieldHost.id = 'uivf12-page-control-shield';
        controlShieldHost.style.cssText = 'position:fixed;inset:0;z-index:2147483646;display:block;pointer-events:auto;cursor:not-allowed;touch-action:none;';
        const shieldRoot = controlShieldHost.attachShadow ? controlShieldHost.attachShadow({ mode: 'open' }) : controlShieldHost;
        shieldRoot.innerHTML = \`
            <style>
                *{box-sizing:border-box}.shield{position:fixed;inset:0;overflow:hidden;background:rgba(2,6,23,.08);border:2px solid rgba(103,232,249,.72);box-shadow:inset 0 0 75px rgba(34,211,238,.18),inset 0 0 150px rgba(139,92,246,.12);animation:aura 1.8s ease-in-out infinite;pointer-events:auto}
                .edge{position:absolute;z-index:2;pointer-events:none;background-size:320% 320%;filter:saturate(1.35) brightness(1.3);box-shadow:0 0 18px currentColor}.top,.bottom{left:0;width:100%;height:7px;background-image:linear-gradient(90deg,#22d3ee,#3b82f6,#8b5cf6,#ec4899,#f59e0b,#22d3ee);animation:flowX 2.2s linear infinite}.top{top:0}.bottom{bottom:0;animation-direction:reverse}.left,.right{top:0;height:100%;width:7px;background-image:linear-gradient(180deg,#22d3ee,#3b82f6,#8b5cf6,#ec4899,#f59e0b,#22d3ee);animation:flowY 2.2s linear infinite}.left{left:0;animation-direction:reverse}.right{right:0}
                .scan{position:absolute;left:0;right:0;top:-12%;height:12%;pointer-events:none;background:linear-gradient(180deg,transparent,rgba(103,232,249,.10),rgba(167,139,250,.16),transparent);filter:blur(1px);animation:scan 3.2s linear infinite}.badge{position:absolute;top:12px;left:50%;transform:translateX(-50%);padding:7px 13px;border:1px solid rgba(103,232,249,.48);border-radius:999px;background:rgba(15,23,42,.9);box-shadow:0 8px 28px rgba(0,0,0,.3),0 0 24px rgba(34,211,238,.18);color:#a5f3fc;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;font-size:11px;font-weight:850;letter-spacing:.08em;white-space:nowrap;pointer-events:none}.shield-message{position:absolute;left:50%;bottom:34px;transform:translate(-50%,18px);max-width:calc(100vw - 40px);padding:11px 16px;border:1px solid rgba(251,191,36,.52);border-radius:10px;background:rgba(15,23,42,.96);box-shadow:0 16px 44px rgba(0,0,0,.42),0 0 26px rgba(245,158,11,.18);color:#fde68a;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;font-size:12px;font-weight:800;text-align:center;opacity:0;transition:opacity .18s ease,transform .18s ease;pointer-events:none}.shield-message.show{opacity:1;transform:translate(-50%,0)}
                @keyframes flowX{to{background-position:320% 0}}@keyframes flowY{to{background-position:0 320%}}@keyframes scan{to{top:100%}}@keyframes aura{0%,100%{box-shadow:inset 0 0 65px rgba(34,211,238,.15),inset 0 0 135px rgba(139,92,246,.10)}50%{box-shadow:inset 0 0 95px rgba(34,211,238,.28),inset 0 0 190px rgba(236,72,153,.16)}}
                @media(prefers-reduced-motion:reduce){.edge,.scan,.shield{animation:none}}
            </style>
            <div class="shield">
                <div class="edge top"></div><div class="edge right"></div><div class="edge bottom"></div><div class="edge left"></div><div class="scan"></div>
                <div class="badge">⚡ 数据抓取控制中 · 页面已锁定</div>
                <div class="shield-message">数据抓取正在控制页面，请暂时不要操作；可使用右上角浮窗查看进度。</div>
            </div>\`;
        const shield = shieldRoot.querySelector('.shield');
        shield.addEventListener('pointerdown', function (event) { event.preventDefault(); event.stopPropagation(); showShieldMessage(); });
        shield.addEventListener('click', function (event) { event.preventDefault(); event.stopPropagation(); });
        shield.addEventListener('contextmenu', function (event) { event.preventDefault(); showShieldMessage(); });
        shield.addEventListener('wheel', function (event) { event.preventDefault(); showShieldMessage(); }, { passive: false });
        document.documentElement.appendChild(controlShieldHost);
        window.addEventListener('keydown', blockPageKeyboard, true);
        showShieldMessage();
    }

    function removeControlShield() {
        clearTimeout(shieldToastTimer);
        window.removeEventListener('keydown', blockPageKeyboard, true);
        if (controlShieldHost) controlShieldHost.remove();
        controlShieldHost = null;
    }

    function installCaptureBridge() {
        captureActive = true;
        installControlShield();
        URL.createObjectURL = function (blob) {
            const url = nativeCreateObjectURL(blob);
            if (blob instanceof Blob) blobByUrl.set(url, blob);
            return url;
        };
        URL.revokeObjectURL = function (url) { nativeRevokeObjectURL(url); };
        HTMLAnchorElement.prototype.click = function () {
            const blob = blobByUrl.get(this.href);
            if (captureActive && this.download && blob) {
                const originalName = String(this.download || ('capture-' + (capturedFiles.length + 1) + '.csv'));
                let name = originalName
                    .replace(/[\\/\\\\:*?"<>|]/g, '_')
                    .replace(/[. ]+$/g, '');
                if (!name) name = 'capture-' + (capturedFiles.length + 1) + '.csv';
                const duplicates = capturedFiles.filter(function (file) { return file.baseName === name; }).length;
                const finalName = duplicates ? name.replace(/(\\.csv)?$/i, '-' + (duplicates + 1) + '$1') : name;
                capturedFiles.push({
                    name: finalName,
                    originalName: originalName,
                    baseName: name,
                    blob: blob,
                    taskIndex: currentTask ? currentTask.index : -1,
                    taskName: currentTask ? currentTask.name : '未归类指标'
                });
                return;
            }
            return nativeAnchorClick.apply(this, arguments);
        };
        window.__uivf12FloatingCaptureBridge = {
            taskStart: function (task) { currentTask = task; setTaskState(task, 'running'); },
            taskEnd: function (task) { setTaskState(task, 'done'); currentTask = null; },
            executeTask: async function (task, runner) {
                taskRunners.set(task.index, runner);
                currentTask = task;
                setTaskState(task, 'running');
                try {
                    await runner();
                    setTaskState(task, 'done');
                } catch (error) {
                    setTaskState(task, 'failed');
                    throw error;
                } finally {
                    currentTask = null;
                }
            }
        };
    }

    function restoreCaptureBridge() {
        captureActive = false;
        removeControlShield();
        URL.createObjectURL = nativeCreateObjectURL;
        URL.revokeObjectURL = nativeRevokeObjectURL;
        HTMLAnchorElement.prototype.click = nativeAnchorClick;
        try { delete window.__uivf12FloatingCaptureBridge; } catch (error) { window.__uivf12FloatingCaptureBridge = null; }
    }

    function crc32(bytes) {
        let crc = -1;
        for (let index = 0; index < bytes.length; index++) {
            crc ^= bytes[index];
            for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
        }
        return (crc ^ -1) >>> 0;
    }

    function zipHeader(size) { return new Uint8Array(size); }
    function set16(view, offset, value) { view.setUint16(offset, value, true); }
    function set32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }
    async function buildZipBlob(files) {
        const encoder = new TextEncoder();
        const chunks = [];
        const central = [];
        let offset = 0;
        for (const file of files) {
            const nameBytes = encoder.encode(file.name);
            const data = new Uint8Array(await file.blob.arrayBuffer());
            const crc = crc32(data);
            const local = zipHeader(30 + nameBytes.length);
            const localView = new DataView(local.buffer);
            set32(localView, 0, 0x04034b50); set16(localView, 4, 20); set16(localView, 6, 0x0800); set16(localView, 8, 0);
            set32(localView, 14, crc); set32(localView, 18, data.length); set32(localView, 22, data.length); set16(localView, 26, nameBytes.length);
            local.set(nameBytes, 30);
            chunks.push(local, data);
            const entry = zipHeader(46 + nameBytes.length);
            const entryView = new DataView(entry.buffer);
            set32(entryView, 0, 0x02014b50); set16(entryView, 4, 20); set16(entryView, 6, 20); set16(entryView, 8, 0x0800); set16(entryView, 10, 0);
            set32(entryView, 16, crc); set32(entryView, 20, data.length); set32(entryView, 24, data.length); set16(entryView, 28, nameBytes.length); set32(entryView, 42, offset);
            entry.set(nameBytes, 46);
            central.push(entry);
            offset += local.length + data.length;
        }
        const centralSize = central.reduce(function (sum, item) { return sum + item.length; }, 0);
        const end = zipHeader(22);
        const endView = new DataView(end.buffer);
        set32(endView, 0, 0x06054b50); set16(endView, 8, files.length); set16(endView, 10, files.length); set32(endView, 12, centralSize); set32(endView, 16, offset);
        return new Blob(chunks.concat(central, [end]), { type: 'application/zip' });
    }

    function minimizeTool() {
        minimized = true;
        closeChoice.style.display = 'none';
        panel.style.display = 'none';
        miniButton.style.display = 'flex';
        miniButton.className = 'mini-launch' + (captureActive ? ' running' : '');
        syncHostWidth();
    }

    function restoreTool() {
        minimized = false;
        miniButton.style.display = 'none';
        panel.style.display = 'flex';
        syncHostWidth();
    }

    function toggleFullscreen() {
        if (minimized) return;
        fullscreen = !fullscreen;
        fullscreenButton.textContent = fullscreen ? '🗗' : '⛶';
        fullscreenButton.title = fullscreen ? '退出全屏' : '全屏查看';
        syncHostWidth();
    }

    function terminateTool() {
        terminated = true;
        window.__uivf12FloatingCaptureStopRequested = true;
        closeChoice.style.display = 'none';
        window.removeEventListener('resize', syncHostWidth);
        if (netCareController && typeof netCareController.destroy === 'function') netCareController.destroy();
        if (dataFabController && typeof dataFabController.destroy === 'function') dataFabController.destroy();
        host.remove();
        if (!captureActive) {
            try { delete window.__uivf12FloatingCaptureBridge; } catch (error) { window.__uivf12FloatingCaptureBridge = null; }
        }
    }

    fullscreenButton.addEventListener('click', toggleFullscreen);
    closeButton.addEventListener('click', function () { closeChoice.style.display = 'flex'; });
    minimizeChoice.addEventListener('click', minimizeTool);
    terminateChoice.addEventListener('click', terminateTool);
    cancelChoice.addEventListener('click', function () { closeChoice.style.display = 'none'; });
    miniButton.addEventListener('click', restoreTool);
    prevButton.addEventListener('click', function () { if (currentPage > 1) { currentPage--; renderDetail(); } });
    nextButton.addEventListener('click', function () { currentPage++; renderDetail(); });
    zipButton.addEventListener('click', async function () {
        if (!capturedFiles.length) return;
        zipButton.disabled = true;
        zipButton.textContent = '正在生成 ZIP…';
        try {
            const zipBlob = await buildZipBlob(capturedFiles);
            const url = nativeCreateObjectURL(zipBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = ${JSON.stringify(siteName.replace(/[^\w\u4e00-\u9fff-]+/g, '_'))} + '_全部CSV_' + new Date().toISOString().slice(0, 10) + '.zip';
            document.body.appendChild(link);
            nativeAnchorClick.call(link);
            link.remove();
            setTimeout(function () { nativeRevokeObjectURL(url); }, 1500);
        } finally {
            zipButton.disabled = false;
            zipButton.textContent = '下载全部 CSV（ZIP）';
        }
    });

    rerunOneButton.addEventListener('click', async function () {
        const task = taskMeta.find(function (item) { return item.index === selectedTaskIndex; });
        const runner = task && taskRunners.get(task.index);
        if (!task || !runner || captureActive) return;
        for (let index = capturedFiles.length - 1; index >= 0; index--) {
            if (capturedFiles[index].taskIndex === task.index) capturedFiles.splice(index, 1);
        }
        window.__uivf12FloatingCaptureStopRequested = false;
        startButton.disabled = true;
        rerunOneButton.disabled = true;
        zipButton.disabled = true;
        notice.className = 'notice running';
        notice.textContent = '正在重新抓取当前指标：' + task.name;
        status.className = 'status running';
        status.textContent = '当前指标旧数据已清除，新 CSV 将继续由浮窗接管。';
        installCaptureBridge();
        try {
            await window.__uivf12FloatingCaptureBridge.executeTask(task, runner);
            restoreCaptureBridge();
            if (terminated) return;
            await renderMetrics();
            await renderDetail();
            notice.className = 'notice done';
            notice.textContent = '当前指标已重新抓取完成：' + task.name;
            status.className = 'status done';
            status.textContent = '当前指标数据已更新，其他指标数据保持不变。';
        } catch (error) {
            restoreCaptureBridge();
            if (terminated) return;
            await renderMetrics();
            await renderDetail();
            notice.className = 'notice bad';
            notice.textContent = '当前指标重新抓取失败，其他指标数据未受影响。';
            status.className = 'status bad';
            status.textContent = '重新抓取失败：' + (error && error.message ? error.message : String(error));
            console.error('[UIVF12 Floating Capture] single task rerun failed', error);
        } finally {
            startButton.disabled = false;
            startButton.textContent = '重新抓取全部数据';
            rerunOneButton.disabled = false;
            zipButton.disabled = false;
            miniButton.className = 'mini-launch';
        }
    });

    startButton.addEventListener('click', async function () {
        if (startButton.disabled) return;
        if (netCareController && typeof netCareController.isLoading === 'function' && netCareController.isLoading()) {
            notice.className = 'notice bad';
            notice.textContent = 'NetCare 专题数据仍在获取中，请等待专题刷新完成后再启动 CSV 抓取。';
            return;
        }
        if (dataFabController && typeof dataFabController.isLoading === 'function' && dataFabController.isLoading()) {
            notice.className = 'notice bad';
            notice.textContent = 'DataFab 专题数据仍在获取中，请等待专题刷新完成后再启动 CSV 抓取。';
            return;
        }
        if (netCareController && typeof netCareController.showCsv === 'function') netCareController.showCsv();
        if (dataFabController && typeof dataFabController.showCsv === 'function') dataFabController.showCsv();
        terminated = false;
        window.__uivf12FloatingCaptureStopRequested = false;
        startButton.disabled = true;
        startButton.textContent = '抓取运行中…';
        miniButton.className = 'mini-launch running';
        notice.className = 'notice running';
        notice.textContent = '抓取进行中：CSV 正在由浮窗接管，请保持当前页面打开。';
        status.className = 'status running';
        status.textContent = '正在准备数据接管，CSV 将保留在浮窗中，不会逐个下载。';
        capturedFiles.length = 0;
        taskStates.forEach(function (_, key) { taskStates.set(key, 'pending'); });
        selectedTaskIndex = null;
        detail.style.display = 'none';
        results.style.display = 'none';
        installCaptureBridge();
        try {
            await ${masterCode}
            restoreCaptureBridge();
            miniButton.className = 'mini-launch';
            if (terminated) return;
            await renderMetrics();
            notice.className = 'notice done';
            notice.textContent = '抓取已完成。点击下方指标查看详表，或一次下载全部 CSV 压缩包。';
            status.className = 'status done';
            status.textContent = '抓取完成：已接管 ' + capturedFiles.length + ' 个 CSV。点击指标查看详表，或下载全部 ZIP。';
            startButton.disabled = false;
            startButton.textContent = '重新抓取全部数据';
        } catch (error) {
            restoreCaptureBridge();
            miniButton.className = 'mini-launch';
            if (terminated) return;
            await renderMetrics();
            notice.className = 'notice bad';
            notice.textContent = '抓取已中断。已成功获得的数据仍可继续查看和下载。';
            status.className = 'status bad';
            status.textContent = '抓取中断：' + (error && error.message ? error.message : String(error)) + '；已保留成功获得的数据。';
            startButton.disabled = false;
            startButton.textContent = '重新开始抓取';
            console.error('[UIVF12 Floating Capture] failed', error);
        }
    });
    document.documentElement.appendChild(host);
})();`;
}

function buildAndCopyMasterScript(scriptsToRun, groupName, options = {}) {
    if (scriptsToRun.length === 0) { alert(UIVT('uiv.copy.emptyGroup')); return; }

    const taskMeta = scriptsToRun.map((script, index) => {
        let origin = '';
        const resolvedUrl = resolveUivScriptUrl(script);
        const openUrl = resolveUivOpenUrl(script, resolvedUrl);
        try {
            origin = new URL(openUrl || resolvedUrl || '').origin;
        } catch (e) {}
        return {
            index,
            name: script.name || `Task ${index + 1}`,
            url: resolvedUrl || '',
            openUrl,
            origin
        };
    });

    let masterCode = `(async function() {\n    const allTasks = ${JSON.stringify(taskMeta, null, 4)};\n    const currentOrigin = window.location.origin;\n    const runnableTasks = allTasks.filter(task => task.origin && task.origin === currentOrigin);\n    const skippedTasks = allTasks.filter(task => !task.origin || task.origin !== currentOrigin);\n    const originSummary = allTasks.reduce((acc, task) => {\n        const key = task.origin || "未识别URL";\n        acc[key] = (acc[key] || 0) + 1;\n        return acc;\n    }, {});\n\n    console.log("%c🚦 [批量调度·${groupName}] 当前页面: " + currentOrigin, "font-size: 14px; font-weight: bold; color: #38bdf8; background: #0f172a; padding: 6px 10px; border-radius: 6px;");\n    console.table(originSummary);\n\n    if (runnableTasks.length === 0) {\n        console.warn("⏸️ [批量调度·${groupName}] 当前页面没有可执行任务，已暂停。请打开上表中的对应站点后，再把这段脚本粘贴到那个页面的控制台执行。");\n        console.table(allTasks.map(task => ({ name: task.name, origin: task.origin || "未识别URL", url: task.url })));\n        return;\n    }\n\n    console.log("%c🚀 [批量调度·${groupName}] 阵列启动！当前站点匹配 " + runnableTasks.length + " 个任务；另有 " + skippedTasks.length + " 个非当前站点任务已自动跳过。", "font-size: 16px; font-weight: bold; color: #00d2d3; background: #222f3e; padding: 8px 12px; border-radius: 6px; border-left: 5px solid #00d2d3;");\n    if (skippedTasks.length > 0) console.table(skippedTasks.map(task => ({ name: task.name, origin: task.origin || "未识别URL", url: task.url })));\n\n    let completedCount = 0;\n\n`;

    scriptsToRun.forEach((script, index) => {
        const rawName = script.name || `Task ${index + 1}`;
        const safeCommentName = rawName.replace(/[\r\n]+/g, ' ');
        const safeNameLiteral = JSON.stringify(rawName);
        masterCode += `    if (runnableTasks.some(task => task.index === ${index}) && !(window.__uivf12FloatingCaptureBridge && window.__uivf12FloatingCaptureStopRequested)) {\n        const currentTaskNo = ++completedCount;\n        const floatingBridge_${index} = window.__uivf12FloatingCaptureBridge;\n        // ========================================================\n        // 📦 队列 [${index + 1}/${scriptsToRun.length}]: ${safeCommentName}\n        // ========================================================\n        console.log("%c\\n▶️ [调度进度: " + currentTaskNo + "/" + runnableTasks.length + "] 开始注入执行: " + ${safeNameLiteral}, "font-size: 14px; font-weight: bold; color: #feca57; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);")\n        const taskRunner_${index} = async function () {\n\n`;

        let cCode = script.consoleCode || '';
        if (!cCode) masterCode += `        console.error("⚠️ [警告] 该脚本缺少控制台版本的代码，自动跳过！");\n`;
        else {
            cCode = cCode.trim();
            masterCode += (cCode.startsWith('(async') ? `        await ${cCode}\n` : `        ${cCode}\n`);
        }

        masterCode += `\n        };\n        if (floatingBridge_${index} && typeof floatingBridge_${index}.executeTask === 'function') {\n            await floatingBridge_${index}.executeTask({ index: ${index}, name: ${safeNameLiteral} }, taskRunner_${index});\n        } else {\n            await taskRunner_${index}();\n        }\n        if (completedCount < runnableTasks.length && !(window.__uivf12FloatingCaptureBridge && window.__uivf12FloatingCaptureStopRequested)) {\n            let delay_${index} = Math.floor(Math.random() * 3000) + 3000;\n            console.log("%c⏳ [调度防刷机制] 正在执行系统冷却... 随机阻断 " + (delay_${index}/1000).toFixed(1) + " 秒...", "color: #95a5a6; font-style: italic; font-size: 12px;");\n            await new Promise(r => setTimeout(r, delay_${index}));\n        }\n    }\n\n`;
    });

    masterCode += `\n    console.log("%c\\n🎉 [批量调度·${groupName}] 当前站点 " + runnableTasks.length + " 个任务执行完毕！如需执行其他站点任务，请打开对应站点后重新粘贴本脚本。", "font-size: 16px; font-weight: bold; color: #1dd1a1; background: #222f3e; padding: 8px 12px; border-radius: 6px; border-left: 5px solid #1dd1a1;");\n})();`;

    const copyCode = options.floatingLauncher
        ? wrapMasterScriptWithFloatingLauncher(masterCode, {
            siteName: options.siteName,
            expectedOrigin: options.expectedOrigin,
            taskCount: scriptsToRun.length,
            taskMeta,
            ruleBundle: options.ruleBundle,
            netCareRuntimeSource: options.netCareRuntimeSource,
            dataFabRuntimeSource: options.dataFabRuntimeSource
        })
        : masterCode;
    copyFromMemory(copyCode, options.floatingLauncher
        ? `${groupName} 浮窗启动脚本`
        : UIVT('uiv.copy.batchType', { group: groupName }));
}

window.UIVCopy = {
    copyCodeText,
    copyFromMemory,
    copyAllConsoleScripts,
    copyAllUivScripts,
    runAllUivScriptsDirect,
    runTestUivScriptsDirect,
    openSiteConsoleScriptPicker,
    closeSiteConsoleScriptPicker,
    copySiteConsoleScripts,
    openTopicFloatingSimulator,
    closeTopicFloatingSimulator,
    openUivBatchCategoryFilter,
    closeUivBatchCategoryFilter,
    selectAllUivBatchCategories,
    clearAllUivBatchCategories,
    resetUivBatchCategoryFilter,
    saveUivBatchCategoryFilter,
    cycleUivBatchSpeed,
    updateUivBatchSpeedButton,
    buildAndCopyMasterScript,
    buildAndCopyUivBatchMacro,
    buildUivBatchMacro
};
window.UIVBatch = window.UIVCopy; // alias

document.addEventListener('DOMContentLoaded', () => {
    updateUivBatchSpeedButton();
    startUivBatchSchedule();
});
