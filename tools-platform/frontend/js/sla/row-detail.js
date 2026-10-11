/**
 * sla/row-detail.js - 详单数据行双击竖排紧凑详情、空字段隐藏、一键复制与常用字段服务器记忆置顶
 */
(function() {
    // 内存缓存各表类型的常用复制字段统计
    // 格式：{ [tableType]: { frequentFields: string[], fieldCounts: { [fieldName]: number }, lastLoaded: number } }
    const copiedFieldsCache = {};

    let currentSecId = null;
    let currentRowIndex = 0;
    let hideEmptyFields = true; // 默认自动隐藏空字段
    let searchQuery = '';

    /**
     * 判断字段值是否为空
     */
    function isFieldEmpty(val) {
        if (val === undefined || val === null) return true;
        const str = String(val).trim();
        if (str === '') return true;
        const lower = str.toLowerCase();
        if (lower === 'null' || lower === 'undefined' || lower === 'none' || lower === 'nan' || str === '-' || str === '--') return true;
        return false;
    }

    /**
     * 剥除文本中的 HTML 标签，返回干净的纯文本
     */
    function stripHtml(str) {
        if (!str) return '';
        return String(str).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    /**
     * 判断字段是否为内部保留字段（不作为业务字段直接平铺）
     */
    function isInternalField(key) {
        if (!key) return true;
        if (key.startsWith('_')) return true;
        return false;
    }

    /**
     * 获取指定表类型并格式化
     */
    function getTableType(secId) {
        const state = window.AppState && window.AppState[secId];
        return (state && state.mode) ? state.mode : secId;
    }

    /**
     * 从服务端拉取常用复制字段统计
     */
    async function fetchCopiedFields(tableType) {
        const normalized = String(tableType || 'general').trim().toLowerCase();
        try {
            const res = await API.get(`/api/sla/copied-fields?tableType=${encodeURIComponent(normalized)}`);
            if (res && res.success) {
                copiedFieldsCache[normalized] = {
                    frequentFields: Array.isArray(res.frequentFields) ? res.frequentFields : [],
                    fieldCounts: (res.fieldCounts && typeof res.fieldCounts === 'object') ? res.fieldCounts : {},
                    lastLoaded: Date.now()
                };
            }
        } catch (e) {
            console.warn('[SLARowDetail] 获取常用复制字段失败，使用本地缓存:', e);
            if (!copiedFieldsCache[normalized]) {
                copiedFieldsCache[normalized] = { frequentFields: [], fieldCounts: {}, lastLoaded: Date.now() };
            }
        }
        return copiedFieldsCache[normalized];
    }

    /**
     * 预加载所有已知详单类型的常用复制字段
     */
    async function preloadAllTableTypes() {
        const types = ['rectification', 'special', 'risk', 'sr', 'vulnerability'];
        for (const t of types) {
            fetchCopiedFields(t);
        }
    }

    // 项目内置各表常用复制字段默认值（整改/CPT专项/常规风险/SR/漏洞预警）
    const DEFAULT_FREQUENT_FIELDS = {
        rectification: ['task_id', 'task_owner', 'fullname', 'product_line_name', 'network_name'],
        special: ['task_id', 'network_name', 'owner_show'],
        risk: ['task_id', 'network', 'product_level_l1', 'product', 'current_handler', 'current_handler_name'],
        sr: ['sr_num', 't1_operator', 'product_line_map', 'product', 'sr_owner'],
        vulnerability: ['task_id', 'task_status', 'network_customer_name', 'task_owner_name']
    };

    /**
     * 同步获取当前缓存的常用字段列表
     */
    function getCachedFrequentFields(tableType) {
        const normalized = String(tableType || 'general').trim().toLowerCase();
        const cached = copiedFieldsCache[normalized];
        if (cached && Array.isArray(cached.frequentFields) && cached.frequentFields.length > 0) {
            return cached.frequentFields;
        }
        return DEFAULT_FREQUENT_FIELDS[normalized] || [];
    }

    /**
     * 同步获取某字段的复制频次
     */
    function getFieldCopyCount(tableType, fieldName) {
        const normalized = String(tableType || 'general').trim().toLowerCase();
        const cached = copiedFieldsCache[normalized];
        if (cached && cached.fieldCounts && cached.fieldCounts[fieldName] !== undefined) {
            return cached.fieldCounts[fieldName];
        }
        const defaults = DEFAULT_FREQUENT_FIELDS[normalized] || [];
        return defaults.includes(fieldName) ? 1 : 0;
    }

    /**
     * 记录复制事件（先乐观更新本地缓存，再异步提交服务端持久化）
     */
    async function recordFieldCopy(tableType, fieldName) {
        const normalized = String(tableType || 'general').trim().toLowerCase();
        if (!copiedFieldsCache[normalized]) {
            copiedFieldsCache[normalized] = { frequentFields: [], fieldCounts: {}, lastLoaded: Date.now() };
        }
        const cache = copiedFieldsCache[normalized];
        const newCount = (cache.fieldCounts[fieldName] || 0) + 1;
        cache.fieldCounts[fieldName] = newCount;
        if (!cache.frequentFields.includes(fieldName)) {
            cache.frequentFields.push(fieldName);
        }
        // 按频次重新降序排序
        cache.frequentFields.sort((a, b) => (cache.fieldCounts[b] || 0) - (cache.fieldCounts[a] || 0));

        // 异步向服务端发送记录
        try {
            await API.post('/api/sla/copied-fields', {
                tableType: normalized,
                fieldName: fieldName
            });
        } catch (e) {
            console.warn('[SLARowDetail] 服务端保存常用字段失败:', e);
        }
    }

    /**
     * 安全复制文本到剪贴板
     */
    async function copyTextToClipboard(text) {
        if (text == null) text = '';
        const str = String(text);
        if (navigator.clipboard && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(str);
                return true;
            } catch (err) {}
        }
        // 兼容降级方案
        const textArea = document.createElement('textarea');
        textArea.value = str;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        textArea.setAttribute('readonly', '');
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        let successful = false;
        try {
            successful = document.execCommand('copy');
        } catch (err) {
            successful = false;
        }
        document.body.removeChild(textArea);
        return successful;
    }

    /**
     * 创建或获取弹窗容器 DOM
     */
    function ensureModalDOM() {
        let modal = document.getElementById('sla-row-detail-modal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'sla-row-detail-modal';
        modal.className = 'modal-overlay sla-row-detail-overlay';
        modal.style.display = 'none';

        modal.innerHTML = `
            <div class="modal-content sla-row-detail-content" onclick="event.stopPropagation()">
                <div class="modal-header sla-row-detail-header">
                    <div class="sla-row-detail-title-wrap">
                        <h3 id="sla-detail-title">📄 详单行详情</h3>
                        <div class="sla-detail-meta-tags">
                            <span id="sla-detail-row-badge" class="sla-detail-badge-pill">第 1 行</span>
                            <span id="sla-detail-sla-status" class="sla-detail-badge-pill sla-status-pill" style="display:none;"></span>
                        </div>
                    </div>
                    <div class="sla-detail-header-actions">
                        <button type="button" class="sla-detail-nav-btn" onclick="window.SLARowDetail.navigate(-1)" title="快捷键: ← / 上一行">⬅ 上一行</button>
                        <button type="button" class="sla-detail-nav-btn" onclick="window.SLARowDetail.navigate(1)" title="快捷键: → / 下一行">下一行 ➡</button>
                        <button type="button" class="modal-close" onclick="window.SLARowDetail.close()" title="关闭 (Esc)">✖</button>
                    </div>
                </div>

                <div class="sla-row-detail-toolbar">
                    <div class="sla-detail-search-box">
                        <span class="sla-search-icon">🔍</span>
                        <input type="text" id="sla-detail-search-input" class="sla-detail-search-input" placeholder="实时过滤字段名或字段内容..." oninput="window.SLARowDetail.handleSearch(this.value)">
                        <button type="button" class="sla-detail-search-clear" onclick="window.SLARowDetail.clearSearch()" title="清空搜索">✕</button>
                    </div>
                    <div class="sla-detail-toolbar-actions">
                        <button type="button" id="sla-detail-toggle-empty" class="sla-detail-tool-btn active" onclick="window.SLARowDetail.toggleEmptyFields()">
                            👁️ 自动隐藏空字段 (<span id="sla-detail-empty-count">0</span>项)
                        </button>
                        <button type="button" class="sla-detail-tool-btn copy-all-btn" onclick="window.SLARowDetail.copyAllNonEmpty()" title="将本行所有非空字段以键值对形式复制到剪贴板">
                            📋 复制全部非空字段
                        </button>
                        <button type="button" class="sla-detail-tool-btn sync-table-btn" onclick="window.SLARowDetail.syncFrequentToMainTable()" title="将服务端已记住的常用字段同步置顶至下方主表格列首">
                            📌 常用列置顶主表
                        </button>
                    </div>
                </div>

                <div class="sla-detail-frequent-hint" id="sla-detail-frequent-hint">
                    💡 <b>常用复制字段已自动置顶并在前方突出显示</b>。每次点击复制，服务器会自动累加频次并长期记住。
                </div>

                <div class="modal-body sla-row-detail-body" id="sla-row-detail-body">
                    <!-- 字段竖排紧凑小字列表将在此渲染 -->
                </div>

                <div class="modal-footer sla-row-detail-footer">
                    <div class="sla-detail-footer-stats" id="sla-detail-footer-stats">
                        显示 0 / 0 个字段
                    </div>
                    <button type="button" class="btn-save sla-detail-close-btn" onclick="window.SLARowDetail.close()">完成并关闭</button>
                </div>
            </div>
        `;

        // 点击遮罩空白处关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                window.SLARowDetail.close();
            }
        });

        document.body.appendChild(modal);

        // 绑定键盘快捷键
        document.addEventListener('keydown', (e) => {
            const m = document.getElementById('sla-row-detail-modal');
            if (!m || m.style.display === 'none') return;
            if (e.key === 'Escape') {
                window.SLARowDetail.close();
            } else if (e.key === 'ArrowLeft' && !e.target.matches('input, textarea')) {
                window.SLARowDetail.navigate(-1);
            } else if (e.key === 'ArrowRight' && !e.target.matches('input, textarea')) {
                window.SLARowDetail.navigate(1);
            }
        });

        return modal;
    }

    /**
     * 打开指定数据行的字段详情弹窗
     */
    async function open(secId, rowIndex) {
        const state = window.AppState && window.AppState[secId];
        if (!state || !state.currentDisplayData || !state.currentDisplayData.length) return;

        currentSecId = secId;
        currentRowIndex = Math.max(0, Math.min(rowIndex, state.currentDisplayData.length - 1));

        const tableType = getTableType(secId);
        // 如果该表类型的常用字段尚未拉取过，先拉取
        if (!copiedFieldsCache[tableType]) {
            await fetchCopiedFields(tableType);
        }

        const modal = ensureModalDOM();
        modal.style.display = 'flex';
        searchQuery = '';
        const searchInput = document.getElementById('sla-detail-search-input');
        if (searchInput) searchInput.value = '';

        renderDetailModal();
    }

    /**
     * 关闭弹窗
     */
    function close() {
        const modal = document.getElementById('sla-row-detail-modal');
        if (modal) modal.style.display = 'none';
    }

    /**
     * 上一行 / 下一行导航
     */
    function navigate(delta) {
        if (!currentSecId) return;
        const state = window.AppState && window.AppState[currentSecId];
        if (!state || !state.currentDisplayData) return;
        const newIndex = currentRowIndex + delta;
        if (newIndex >= 0 && newIndex < state.currentDisplayData.length) {
            currentRowIndex = newIndex;
            renderDetailModal();
        } else {
            if (window.showToast) {
                window.showToast(delta < 0 ? '已是第一行' : '已是最后一行', 'info');
            }
        }
    }

    /**
     * 切换空字段显示状态
     */
    function toggleEmptyFields() {
        hideEmptyFields = !hideEmptyFields;
        const btn = document.getElementById('sla-detail-toggle-empty');
        if (btn) {
            if (hideEmptyFields) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
        renderDetailModal();
    }

    /**
     * 搜索字段
     */
    function handleSearch(val) {
        searchQuery = String(val || '').trim().toLowerCase();
        renderDetailModal();
    }

    function clearSearch() {
        searchQuery = '';
        const searchInput = document.getElementById('sla-detail-search-input');
        if (searchInput) searchInput.value = '';
        renderDetailModal();
    }

    /**
     * 渲染弹窗全部内容
     */
    function renderDetailModal() {
        if (!currentSecId) return;
        const state = window.AppState && window.AppState[currentSecId];
        if (!state || !state.currentDisplayData) return;

        const row = state.currentDisplayData[currentRowIndex];
        if (!row) return;

        const tableType = getTableType(currentSecId);
        const frequentFields = getCachedFrequentFields(tableType);

        // 1. 设置头部标题与行信息
        const titleEl = document.getElementById('sla-detail-title');
        if (titleEl) {
            const tableTitle = state.title || '数据详单';
            titleEl.innerHTML = `<span class="sla-detail-title-icon">📋</span> ${escapeHTML(tableTitle)} · 字段详情`;
        }
        const rowBadge = document.getElementById('sla-detail-row-badge');
        if (rowBadge) {
            rowBadge.innerText = `第 ${currentRowIndex + 1} 行 (共 ${state.currentDisplayData.length} 行)`;
        }

        // SLA 状态标签
        const slaStatusEl = document.getElementById('sla-detail-sla-status');
        if (slaStatusEl) {
            const cleanSla = (row._slaCleanText && row._slaCleanText !== '-')
                ? row._slaCleanText
                : stripHtml(row._slaText);
            if (cleanSla && cleanSla !== '-') {
                slaStatusEl.style.display = 'inline-flex';
                slaStatusEl.textContent = `🚨 ${cleanSla}`;
                slaStatusEl.className = 'sla-detail-badge-pill sla-status-pill ' + (row._rowClass || '');
            } else {
                slaStatusEl.style.display = 'none';
            }
        }

        // 2. 收集本行所有可用字段
        // 优先按 orderedHeaders 顺序，外加 row 中其他非私有属性
        const allKeys = [];
        const seen = new Set();
        (state.orderedHeaders || []).forEach(k => {
            if (!isInternalField(k) && !seen.has(k)) {
                allKeys.push(k);
                seen.add(k);
            }
        });
        Object.keys(row).forEach(k => {
            if (!isInternalField(k) && !seen.has(k)) {
                allKeys.push(k);
                seen.add(k);
            }
        });

        // 3. 区分非空与空字段
        const nonEmptyFields = [];
        const emptyFields = [];

        allKeys.forEach(key => {
            const val = row[key];
            if (isFieldEmpty(val)) {
                emptyFields.push(key);
            } else {
                nonEmptyFields.push(key);
            }
        });

        // 更新空字段数量展示
        const emptyCountEl = document.getElementById('sla-detail-empty-count');
        if (emptyCountEl) emptyCountEl.innerText = emptyFields.length;

        // 4. 排序规则：
        // 常用字段排在最前边（按复制频次降序）！并且突出高亮！
        // 接着是其他普通非空字段（保持原有顺序）
        // 如果开启了显示空字段，空字段放在最后
        const frequentNonEmpty = [];
        const regularNonEmpty = [];

        nonEmptyFields.forEach(k => {
            const count = getFieldCopyCount(tableType, k);
            if (count > 0) {
                frequentNonEmpty.push({ key: k, count });
            } else {
                regularNonEmpty.push(k);
            }
        });

        // 常用字段按频次降序
        frequentNonEmpty.sort((a, b) => b.count - a.count);

        let orderedDisplayKeys = [
            ...frequentNonEmpty.map(item => item.key),
            ...regularNonEmpty
        ];

        if (!hideEmptyFields) {
            // 也包含空字段
            orderedDisplayKeys = orderedDisplayKeys.concat(emptyFields);
        }

        // 5. 应用搜索过滤
        if (searchQuery) {
            orderedDisplayKeys = orderedDisplayKeys.filter(k => {
                const val = row[k] != null ? String(row[k]) : '';
                return k.toLowerCase().includes(searchQuery) || val.toLowerCase().includes(searchQuery);
            });
        }

        // 6. 渲染竖排紧凑字段详情
        const bodyEl = document.getElementById('sla-row-detail-body');
        if (!bodyEl) return;
        const prevScrollTop = bodyEl.scrollTop;

        if (!orderedDisplayKeys.length) {
            bodyEl.innerHTML = `
                <div class="sla-detail-empty-state">
                    ${searchQuery ? '没有找到匹配该搜索条件的字段 🔍' : '当前行所有字段均为空'}
                </div>
            `;
            bodyEl.scrollTop = prevScrollTop;
            const statsEl = document.getElementById('sla-detail-footer-stats');
            if (statsEl) statsEl.innerText = `显示 0 / ${allKeys.length} 个字段`;
            return;
        }

        let html = '<div class="sla-detail-fields-grid">';
        let displayedCount = 0;

        orderedDisplayKeys.forEach((key) => {
            const val = row[key];
            const isEmpty = isFieldEmpty(val);
            const copyCount = getFieldCopyCount(tableType, key);
            const isFrequent = copyCount > 0;
            displayedCount++;

            // 只压缩展示用的空白；复制时仍使用 row 中的原始值。
            const displayVal = isEmpty ? '(空)' : String(val).replace(/\s+/g, ' ').trim();
            const isLong = !isEmpty && displayVal.length > 55;
            const rowClass = [
                'sla-detail-field-item',
                isFrequent ? 'is-frequent' : '',
                isEmpty ? 'is-empty' : '',
                isLong ? 'is-long-content' : ''
            ].filter(Boolean).join(' ');

            html += `
                <div class="${rowClass}" data-field="${escapeHTML(key)}">
                    <div class="sla-detail-field-label-col" title="${escapeHTML(key)}">
                        ${isFrequent ? `<span class="sla-detail-frequent-badge" title="服务端已记住：该字段已累计复制 ${copyCount} 次">⭐ 常用 (${copyCount}次)</span>` : ''}
                        <span class="sla-detail-field-name">${escapeHTML(key)}</span>
                    </div>
                    <div class="sla-detail-field-value-col ${isEmpty ? 'empty-val' : ''}"
                        onclick="window.SLARowDetail.handleCopy('${escapeHTML(key)}', this.parentElement.querySelector('.sla-detail-copy-btn'))"
                        title="点击快速复制内容">${escapeHTML(displayVal)}</div>
                    <button type="button" class="sla-detail-copy-btn" 
                        onclick="window.SLARowDetail.handleCopy('${escapeHTML(key)}', this)" 
                        title="点击一键复制该字段内容">
                        📋
                    </button>
                </div>
            `;
        });

        html += '</div>';
        bodyEl.innerHTML = html;
        bodyEl.scrollTop = prevScrollTop;

        // 7. 更新底部统计
        const statsEl = document.getElementById('sla-detail-footer-stats');
        if (statsEl) {
            statsEl.innerHTML = `已展示 <b>${displayedCount}</b> 个字段（共 ${allKeys.length} 个，已自动隐藏 <b>${emptyFields.length}</b> 个空字段）`;
        }
    }

    /**
     * 单个字段复制响应
     */
    async function handleCopy(fieldName, btnEl) {
        if (!currentSecId) return;
        const state = window.AppState && window.AppState[currentSecId];
        if (!state || !state.currentDisplayData) return;

        const row = state.currentDisplayData[currentRowIndex];
        if (!row) return;

        const val = row[fieldName] !== undefined && row[fieldName] !== null ? String(row[fieldName]) : '';
        const success = await copyTextToClipboard(val);

        if (success) {
            const tableType = getTableType(currentSecId);
            // 记录到服务端和内存
            await recordFieldCopy(tableType, fieldName);

            // 按钮动效反馈
            if (btnEl) {
                const rowEl = btnEl.closest('.sla-detail-field-item');
                const valEl = rowEl ? rowEl.querySelector('.sla-detail-field-value-col') : null;
                const originalText = btnEl.innerHTML;
                btnEl.innerHTML = '<span class="sla-copy-check">✓</span> 已复制';
                btnEl.classList.add('copied');
                if (valEl) valEl.classList.add('copied-flash');
                setTimeout(() => {
                    if (btnEl && btnEl.isConnected) {
                        btnEl.innerHTML = originalText;
                        btnEl.classList.remove('copied');
                    }
                    if (valEl && valEl.isConnected) {
                        valEl.classList.remove('copied-flash');
                    }
                    // 重新刷新以更新右上角 ⭐ 常用(X次) 频次徽章
                    renderDetailModal();
                }, 1200);
            }

            if (window.showToast) {
                const preview = val.length > 35 ? val.slice(0, 35) + '...' : val;
                window.showToast(`已复制「${fieldName}」: ${preview || '(空)'}`);
            }
        } else {
            if (window.showToast) {
                window.showToast('复制失败，请手动选中文本复制', 'error');
            }
        }
    }

    /**
     * 一键复制本行所有非空字段（键值对文本）
     */
    async function copyAllNonEmpty() {
        if (!currentSecId) return;
        const state = window.AppState && window.AppState[currentSecId];
        if (!state || !state.currentDisplayData) return;

        const row = state.currentDisplayData[currentRowIndex];
        if (!row) return;

        const tableType = getTableType(currentSecId);
        const lines = [`=== ${state.title || '详单明细'} (第 ${currentRowIndex + 1} 行) ===`];

        if (row._slaText && row._slaText !== '-') {
            const cleanSla = (row._slaCleanText && row._slaCleanText !== '-')
                ? row._slaCleanText
                : stripHtml(row._slaText);
            if (cleanSla && cleanSla !== '-') {
                lines.push(`预警与 SLA 状态: ${cleanSla}`);
            }
        }

        const allKeys = [];
        const seen = new Set();
        (state.orderedHeaders || []).forEach(k => {
            if (!isInternalField(k) && !seen.has(k)) {
                allKeys.push(k);
                seen.add(k);
            }
        });
        Object.keys(row).forEach(k => {
            if (!isInternalField(k) && !seen.has(k)) {
                allKeys.push(k);
                seen.add(k);
            }
        });

        let copiedFieldCount = 0;
        allKeys.forEach(k => {
            const val = row[k];
            if (!isFieldEmpty(val)) {
                lines.push(`${k}: ${val}`);
                copiedFieldCount++;
                // 也同时记录复制热度
                recordFieldCopy(tableType, k);
            }
        });

        const fullText = lines.join('\n');
        const success = await copyTextToClipboard(fullText);

        if (success) {
            if (window.showToast) {
                window.showToast(`已复制全部非空字段 (共 ${copiedFieldCount} 项)`);
            }
            renderDetailModal();
        }
    }

    /**
     * 同步将服务端已记住的常用复制字段置顶排至主表格列首
     */
    async function syncFrequentToMainTable() {
        if (!currentSecId) return;
        const state = window.AppState && window.AppState[currentSecId];
        if (!state) return;

        const tableType = getTableType(currentSecId);
        const frequentFields = getCachedFrequentFields(tableType);

        if (!frequentFields || !frequentFields.length) {
            if (window.showToast) {
                window.showToast('暂无常用复制字段，请先点击复制相关字段', 'info');
            }
            return;
        }

        // 保留原有效字段
        const currentVisible = [...state.visibleHeaders];
        const validFrequent = frequentFields.filter(f => currentVisible.includes(f));
        const others = currentVisible.filter(f => !validFrequent.includes(f));

        state.visibleHeaders = [...validFrequent, ...others];
        if (window.SLAPrefs && typeof window.SLAPrefs.savePrefs === 'function') {
            await window.SLAPrefs.savePrefs(currentSecId);
        }
        if (window.updateView) {
            window.updateView(currentSecId);
        }

        if (window.showToast) {
            window.showToast(`已将 ${validFrequent.length} 个常用字段排至主表格最前方！`);
        }
    }

    /**
     * 自动优先重排新打开表格的列顺序（将常用复制字段置顶在前面稍微突出显示）
     */
    function prioritizeHeadersWithFrequent(tableType, headers) {
        const frequent = getCachedFrequentFields(tableType);
        if (!frequent || !frequent.length || !Array.isArray(headers)) return headers;

        const validFrequent = frequent.filter(f => headers.includes(f));
        const others = headers.filter(f => !validFrequent.includes(f));
        return [...validFrequent, ...others];
    }

    // 页面加载时自动预加载
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', preloadAllTableTypes);
    } else {
        preloadAllTableTypes();
    }

    window.SLARowDetail = {
        open,
        close,
        navigate,
        toggleEmptyFields,
        handleSearch,
        clearSearch,
        handleCopy,
        copyAllNonEmpty,
        syncFrequentToMainTable,
        fetchCopiedFields,
        getCachedFrequentFields,
        getFieldCopyCount,
        recordFieldCopy,
        prioritizeHeadersWithFrequent,
        preloadAllTableTypes
    };
})();
