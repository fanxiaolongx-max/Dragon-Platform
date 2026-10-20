/**
 * ====================================================================
 * Report Snapshot Persistence & Side-by-Side Visual Diff Engine
 * 专题月报 (topic-analysis) 与 License 月报 (esn-check) 统一支持
 * 服务端 SQLite 存储 + 离线工程导入导出 + 浏览器左右分屏智能比对
 * ====================================================================
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.ReportSnapshotDiff = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // =========================================================
    // 1. 快照持久化管理器 (ReportSnapshotStore)
    // 优先调用服务端 API (/api/monthly-snapshots)，支持 IndexedDB 离线兜底
    // =========================================================
    const ReportSnapshotStore = {
        _dbPromise: null,

        async _getDb() {
            if (this._dbPromise) return this._dbPromise;
            this._dbPromise = new Promise((resolve) => {
                if (typeof indexedDB === 'undefined') {
                    resolve(null);
                    return;
                }
                const request = indexedDB.open('tools_platform_report_snapshots_v1', 1);
                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('snapshots')) {
                        const store = db.createObjectStore('snapshots', { keyPath: 'id' });
                        store.createIndex('by_tool', 'toolKey', { unique: false });
                        store.createIndex('by_month', 'month', { unique: false });
                    }
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => resolve(null);
            });
            return this._dbPromise;
        },

        async _saveLocalBackup(snapshot) {
            try {
                const db = await this._getDb();
                if (!db) return;
                const tx = db.transaction('snapshots', 'readwrite');
                tx.objectStore('snapshots').put(snapshot);
            } catch (_) {}
        },

        async _listLocalBackups(toolKey) {
            try {
                const db = await this._getDb();
                if (!db) return [];
                return new Promise((resolve) => {
                    const tx = db.transaction('snapshots', 'readonly');
                    const store = tx.objectStore('snapshots');
                    const req = store.getAll();
                    req.onsuccess = () => {
                        const all = req.result || [];
                        const filtered = all.filter(item => !toolKey || item.toolKey === toolKey);
                        filtered.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
                        resolve(filtered);
                    };
                    req.onerror = () => resolve([]);
                });
            } catch (_) {
                return [];
            }
        },

        // 获取快照列表 (元数据)
        async listSnapshots({ toolKey, topicKey, month, full = false } = {}) {
            try {
                const params = new URLSearchParams();
                if (toolKey) params.set('toolKey', toolKey);
                if (topicKey) params.set('topicKey', topicKey);
                if (month) params.set('month', month);
                if (full) params.set('full', '1');

                const res = await fetch(`/api/monthly-snapshots?${params.toString()}`);
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data.items)) {
                        return data.items;
                    }
                }
            } catch (err) {
                console.warn('[ReportSnapshotStore] 服务端读取快照失败，尝试读取本地缓存:', err);
            }
            return await this._listLocalBackups(toolKey);
        },

        // 获取单个快照完整数据 (含 payload)
        async getSnapshot(id) {
            if (!id) return null;
            try {
                const res = await fetch(`/api/monthly-snapshots/${encodeURIComponent(id)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.item) {
                        this._saveLocalBackup(data.item);
                        return data.item;
                    }
                }
            } catch (err) {
                console.warn('[ReportSnapshotStore] 从服务端读取快照失败，尝试读取本地:', err);
            }

            // 本地 fallback
            try {
                const db = await this._getDb();
                if (db) {
                    return new Promise((resolve) => {
                        const tx = db.transaction('snapshots', 'readonly');
                        const req = tx.objectStore('snapshots').get(id);
                        req.onsuccess = () => resolve(req.result || null);
                        req.onerror = () => resolve(null);
                    });
                }
            } catch (_) {}
            return null;
        },

        // 保存快照
        async saveSnapshot({ id, toolKey, topicKey = '', month, name, summary = {}, payload = {} }) {
            const snapId = id || `snap_${toolKey}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            const mStr = month || '当月';
            const snapName = name || `${mStr} 月报快照 (${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })})`;

            const body = {
                id: snapId,
                toolKey,
                topicKey,
                month: mStr,
                name: snapName,
                summary,
                payload
            };

            let savedItem = null;
            try {
                const res = await fetch('/api/monthly-snapshots', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                if (res.ok) {
                    const data = await res.json();
                    savedItem = data.item;
                }
            } catch (err) {
                console.warn('[ReportSnapshotStore] 服务端保存快照异常，转为离线存储:', err);
            }

            if (!savedItem) {
                savedItem = {
                    ...body,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
            }

            await this._saveLocalBackup(savedItem);
            return savedItem;
        },

        // 重命名快照
        async renameSnapshot(id, newName) {
            try {
                const res = await fetch(`/api/monthly-snapshots/${encodeURIComponent(id)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: newName })
                });
                if (res.ok) {
                    const data = await res.json();
                    return data.item;
                }
            } catch (err) {
                console.error('[ReportSnapshotStore] 重命名快照失败:', err);
            }
            return null;
        },

        // 删除快照
        async deleteSnapshot(id) {
            try {
                const res = await fetch(`/api/monthly-snapshots/${encodeURIComponent(id)}`, { method: 'DELETE' });
                if (res.ok) {
                    // 同步清理本地
                    try {
                        const db = await this._getDb();
                        if (db) {
                            const tx = db.transaction('snapshots', 'readwrite');
                            tx.objectStore('snapshots').delete(id);
                        }
                    } catch (_) {}
                    return true;
                }
            } catch (err) {
                console.error('[ReportSnapshotStore] 删除快照失败:', err);
            }
            return false;
        }
    };

    // =========================================================
    // 2. 差异检测引擎 (ReportDiffEngine)
    // 涵盖 Myers/LCS 文案分词、表格单元格数值 Delta、以及格式颜色样式深度对比
    // =========================================================
    const ReportDiffEngine = {
        // 分词算法：中文字符拆分为单字，西文字符与数字以词拆分，保留标点与空格
        tokenize(text) {
            if (!text) return [];
            const str = String(text);
            const tokens = [];
            let i = 0;
            const len = str.length;

            while (i < len) {
                const char = str[i];
                // CJK 统一表意文字及扩展
                if (/[\u4e00-\u9fa5\u3400-\u4dbf]/.test(char)) {
                    tokens.push(char);
                    i++;
                } else if (/[a-zA-Z0-9_%.-]/.test(char)) {
                    let word = '';
                    while (i < len && /[a-zA-Z0-9_%.-]/.test(str[i])) {
                        word += str[i];
                        i++;
                    }
                    tokens.push(word);
                } else if (/\s/.test(char)) {
                    let spaces = '';
                    while (i < len && /\s/.test(str[i])) {
                        spaces += str[i];
                        i++;
                    }
                    tokens.push(spaces);
                } else {
                    tokens.push(char);
                    i++;
                }
            }
            return tokens;
        },

        // LCS (最长公共子序列) 差异算法
        diffTokens(tokensA, tokensB) {
            const m = tokensA.length;
            const n = tokensB.length;
            // 简单长度保护（若超长文本做保护截断）
            if (m > 2500 || n > 2500) {
                return [{ type: 'del', val: tokensA.join('') }, { type: 'ins', val: tokensB.join('') }];
            }

            const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
            for (let i = 0; i < m; i++) {
                for (let j = 0; j < n; j++) {
                    if (tokensA[i] === tokensB[j]) {
                        dp[i + 1][j + 1] = dp[i][j] + 1;
                    } else {
                        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
                    }
                }
            }

            const diff = [];
            let i = m, j = n;
            while (i > 0 || j > 0) {
                if (i > 0 && j > 0 && tokensA[i - 1] === tokensB[j - 1]) {
                    diff.unshift({ type: 'eq', val: tokensA[i - 1] });
                    i--;
                    j--;
                } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                    diff.unshift({ type: 'ins', val: tokensB[j - 1] });
                    j--;
                } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
                    diff.unshift({ type: 'del', val: tokensA[i - 1] });
                    i--;
                }
            }

            // 合并连续同类型 diff
            const merged = [];
            diff.forEach(item => {
                if (merged.length && merged[merged.length - 1].type === item.type) {
                    merged[merged.length - 1].val += item.val;
                } else {
                    merged.push({ type: item.type, val: item.val });
                }
            });
            return merged;
        },

        // 文案差异 HTML 渲染
        // 返回：{ hasDiff, baselineHtml, targetHtml, changesCount }
        diffText(textA, textB) {
            const rawA = String(textA || '').trim();
            const rawB = String(textB || '').trim();
            if (rawA === rawB) {
                return { hasDiff: false, baselineHtml: this.escapeHtml(rawA), targetHtml: this.escapeHtml(rawB), changesCount: 0 };
            }

            const tokensA = this.tokenize(rawA);
            const tokensB = this.tokenize(rawB);
            const diffs = this.diffTokens(tokensA, tokensB);

            let baselineHtml = '';
            let targetHtml = '';
            let changesCount = 0;

            diffs.forEach(d => {
                const escaped = this.escapeHtml(d.val);
                if (d.type === 'eq') {
                    baselineHtml += escaped;
                    targetHtml += escaped;
                } else if (d.type === 'del') {
                    baselineHtml += `<del class="report-diff-del">${escaped}</del>`;
                    changesCount++;
                } else if (d.type === 'ins') {
                    targetHtml += `<ins class="report-diff-ins">${escaped}</ins>`;
                    changesCount++;
                }
            });

            return {
                hasDiff: changesCount > 0,
                baselineHtml,
                targetHtml,
                changesCount
            };
        },

        // 颜色规范化（将 rgb(r, g, b) 或英文颜色转为对比字符串）
        normalizeColor(colorStr) {
            if (!colorStr) return '';
            const c = String(colorStr).trim().toLowerCase();
            if (c === 'inherit' || c === 'transparent' || c === 'initial') return '';
            // rgb 转 hex
            const rgbMatch = c.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
            if (rgbMatch) {
                const hex = (x) => parseInt(x, 10).toString(16).padStart(2, '0');
                return `#${hex(rgbMatch[1])}${hex(rgbMatch[2])}${hex(rgbMatch[3])}`;
            }
            return c;
        },

        // 提取主要颜色友好名称
        getColorFriendlyName(colorHex) {
            const c = this.normalizeColor(colorHex);
            if (!c) return '默认';
            if (c.includes('ef4444') || c.includes('dc2626') || c.includes('b91c1c') || c === 'red') return '红色';
            if (c.includes('2563eb') || c.includes('3b82f6') || c.includes('1d4ed8') || c === 'blue') return '蓝色';
            if (c.includes('16a34a') || c.includes('22c55e') || c.includes('15803d') || c === 'green') return '绿色';
            if (c.includes('eab308') || c.includes('f59e0b') || c.includes('d97706') || c === 'yellow' || c === 'orange') return '橙黄色';
            if (c.includes('8b5cf6') || c.includes('a855f7') || c.includes('7e22ce') || c === 'purple') return '紫色';
            if (c.includes('64748b') || c.includes('94a3b8') || c.includes('475569') || c === 'gray') return '灰色';
            return c;
        },

        // 格式、颜色与加粗差异检测
        diffStyles(elA, elB) {
            if (!elA || !elB) return { hasDiff: false, items: [] };

            const items = [];

            // 1. 颜色对比
            const colorA = this.normalizeColor(elA.style?.color || elA.getAttribute?.('color'));
            const colorB = this.normalizeColor(elB.style?.color || elB.getAttribute?.('color'));
            if (colorA !== colorB && (colorA || colorB)) {
                items.push({
                    type: 'color',
                    label: `文字颜色: ${this.getColorFriendlyName(colorA)} ➔ ${this.getColorFriendlyName(colorB)}`,
                    before: colorA,
                    after: colorB
                });
            }

            // 2. 加粗状态对比 (检查 <b>, <strong>, 样式 font-weight)
            const isBoldA = Boolean(
                elA.tagName === 'B' ||
                elA.tagName === 'STRONG' ||
                elA.querySelector?.('b, strong') ||
                /bold|[6-9]00/.test(elA.style?.fontWeight || '')
            );
            const isBoldB = Boolean(
                elB.tagName === 'B' ||
                elB.tagName === 'STRONG' ||
                elB.querySelector?.('b, strong') ||
                /bold|[6-9]00/.test(elB.style?.fontWeight || '')
            );
            if (isBoldA !== isBoldB) {
                items.push({
                    type: 'bold',
                    label: isBoldB ? '样式变动: 新增加粗' : '样式变动: 取消加粗',
                    before: isBoldA,
                    after: isBoldB
                });
            }

            // 3. 背景高亮色对比 (检查 <mark>, background-color)
            const bgA = this.normalizeColor(elA.style?.backgroundColor || (elA.tagName === 'MARK' ? 'yellow' : ''));
            const bgB = this.normalizeColor(elB.style?.backgroundColor || (elB.tagName === 'MARK' ? 'yellow' : ''));
            if (bgA !== bgB && (bgA || bgB)) {
                items.push({
                    type: 'highlight',
                    label: bgB ? `背景高亮: ${this.getColorFriendlyName(bgB)}` : '背景高亮已移除',
                    before: bgA,
                    after: bgB
                });
            }

            return {
                hasDiff: items.length > 0,
                items
            };
        },

        // 表格单元格数值解析与 Delta 变化率计算
        parseNumber(valStr) {
            if (typeof valStr !== 'string') return null;
            const cleaned = valStr.replace(/,/g, '').trim();
            const match = cleaned.match(/^([+-]?\d+(?:\.\d+)?)(%?)$/);
            if (match) {
                return {
                    num: parseFloat(match[1]),
                    isPercent: match[2] === '%'
                };
            }
            return null;
        },

        // HTML 字符转义
        escapeHtml(str) {
            return String(str || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }
    };

    // =========================================================
    // 3. 左右分屏对比弹窗控制器 (ReportDiffViewer)
    // 联动滚动、原地编辑、快速引用基准、差异导航与同步工作区
    // =========================================================
    const ReportDiffViewer = {
        activeModal: null,
        differencesList: [],
        currentDiffIndex: -1,
        activeFilter: 'all', // 'all' | 'text' | 'data' | 'style'
        syncScrollEnabled: true,

        // 打开月报比对模态框
        async openDiffModal({
            toolKey,
            topicKey = '',
            baselineSnapshotId = null,
            targetSnapshotId = null,
            currentHtml = '',
            currentProject = null,
            onApplyToWorkspace = null
        }) {
            if (this.activeModal) this.closeModal();

            // 1. 获取所有可选快照列表
            const snapshots = await ReportSnapshotStore.listSnapshots({ toolKey, topicKey });

            // 2. 确定默认基准快照 (Baseline) 与目标快照 (Target)
            let baselineSnapshot = null;
            if (baselineSnapshotId) {
                baselineSnapshot = await ReportSnapshotStore.getSnapshot(baselineSnapshotId);
            } else if (snapshots.length > 0) {
                // 默认使用最新的一份历史快照作为基准
                baselineSnapshot = await ReportSnapshotStore.getSnapshot(snapshots[0].id);
            }

            let targetSnapshot = null;
            if (targetSnapshotId) {
                targetSnapshot = await ReportSnapshotStore.getSnapshot(targetSnapshotId);
            }

            // 3. 构建分屏比对 DOM
            const overlay = document.createElement('div');
            overlay.className = 'report-diff-overlay';
            overlay.id = 'reportDiffModalOverlay';

            overlay.innerHTML = `
                <div class="report-diff-modal" role="dialog" aria-modal="true" aria-label="月报智能比对">
                    <!-- 顶部工具栏 -->
                    <div class="report-diff-header">
                        <div class="report-diff-header-top">
                            <div class="report-diff-title-wrap">
                                <h3 class="report-diff-title">
                                    <span>🔍</span> 月报智能版本比对
                                </h3>
                                <span class="report-diff-subtitle">分屏比对历史快照与当前月报，自动高亮文案、数据及格式颜色差异</span>
                            </div>
                            <div class="report-diff-top-actions">
                                <button type="button" class="report-diff-btn report-diff-btn-primary" id="rdApplyAllBtn" title="将右侧分屏的确认修改完整同步回主工作区">
                                    <span>💾</span> 应用并同步到工作区
                                </button>
                                <button type="button" class="report-diff-btn-close" id="rdCloseBtn" title="关闭比对窗口">×</button>
                            </div>
                        </div>

                        <!-- 控制条第二行 -->
                        <div class="report-diff-controls-bar">
                            <div class="report-diff-selectors">
                                <div class="report-diff-picker-group">
                                    <label><strong>基准版本 (左侧)：</strong></label>
                                    <select id="rdBaselineSelect" aria-label="选择基准月报快照">
                                        ${snapshots.length ? snapshots.map(s => `
                                            <option value="${ReportDiffEngine.escapeHtml(s.id)}" ${baselineSnapshot && baselineSnapshot.id === s.id ? 'selected' : ''}>
                                                ${ReportDiffEngine.escapeHtml(s.name)} (${ReportDiffEngine.escapeHtml(s.month)})
                                            </option>
                                        `).join('') : '<option value="">暂无历史快照 (请先保存快照)</option>'}
                                    </select>
                                </div>
                                <div class="report-diff-picker-group">
                                    <label><strong>对比目标 (右侧)：</strong></label>
                                    <select id="rdTargetSelect" aria-label="选择目标月报版本">
                                        <option value="__LIVE__" ${!targetSnapshotId ? 'selected' : ''}>当前工作区实时月报 (默认)</option>
                                        ${snapshots.map(s => `
                                            <option value="${ReportDiffEngine.escapeHtml(s.id)}" ${targetSnapshot && targetSnapshot.id === s.id ? 'selected' : ''}>
                                                ${ReportDiffEngine.escapeHtml(s.name)} (${ReportDiffEngine.escapeHtml(s.month)})
                                            </option>
                                        `).join('')}
                                    </select>
                                </div>
                            </div>

                            <!-- 差异类型看板 -->
                            <div class="report-diff-stats-bar" id="rdStatsBar">
                                <span class="report-diff-chip active" data-filter="all" id="rdFilterAll">全部差异 (0)</span>
                                <span class="report-diff-chip report-diff-chip-text" data-filter="text" id="rdFilterText">📝 文案变动 (0)</span>
                                <span class="report-diff-chip report-diff-chip-data" data-filter="data" id="rdFilterData">📊 数据指标 (0)</span>
                                <span class="report-diff-chip report-diff-chip-style" data-filter="style" id="rdFilterStyle">🎨 格式颜色 (0)</span>
                            </div>

                            <!-- 差异导航与工具 -->
                            <div class="report-diff-nav-tools">
                                <button type="button" class="report-diff-btn" id="rdPrevDiffBtn" title="跳转至上一处差异">↑ 上一处</button>
                                <span class="report-diff-nav-counter" id="rdDiffCounter">0 / 0</span>
                                <button type="button" class="report-diff-btn" id="rdNextDiffBtn" title="跳转至下一处差异">↓ 下一处</button>
                                <button type="button" class="report-diff-btn ${this.syncScrollEnabled ? 'report-diff-btn-primary' : ''}" id="rdSyncScrollBtn" title="开启或关闭左右分屏联动滚动">
                                    <span>⇋</span> 联动滚动
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- 分屏内容区 -->
                    <div class="report-diff-split-container">
                        <!-- 左侧基准屏 -->
                        <div class="report-diff-pane report-diff-pane-left" id="rdPaneLeft">
                            <div class="report-diff-pane-banner">
                                <span id="rdLeftBannerTitle">基准月报快照</span>
                                <span class="report-diff-pane-badge badge-baseline" id="rdLeftBannerTag">基准对比源</span>
                            </div>
                            <div class="report-diff-sheet-content report-sheet topic-report-sheet" id="rdLeftSheet">
                                <!-- 基准月报 HTML 将注入此处 -->
                            </div>
                        </div>

                        <!-- 右侧目标屏 -->
                        <div class="report-diff-pane report-diff-pane-right" id="rdPaneRight">
                            <div class="report-diff-pane-banner">
                                <span id="rdRightBannerTitle">本次月报 (可直接在下方编辑修改)</span>
                                <span class="report-diff-pane-badge badge-target" id="rdRightBannerTag">实时编辑区</span>
                            </div>
                            <div class="report-diff-sheet-content report-sheet topic-report-sheet" id="rdRightSheet">
                                <!-- 目标月报 HTML 将注入此处 -->
                            </div>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);
            this.activeModal = overlay;

            // 4. 绑定基础事件 (关闭、选择器切换、联动滚动)
            overlay.querySelector('#rdCloseBtn').addEventListener('click', () => this.closeModal());
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) this.closeModal();
            });

            const baselineSelect = overlay.querySelector('#rdBaselineSelect');
            baselineSelect.addEventListener('change', async () => {
                const sId = baselineSelect.value;
                const snap = sId ? await ReportSnapshotStore.getSnapshot(sId) : null;
                this.renderComparison({
                    baselineSnapshot: snap,
                    targetSnapshot,
                    currentHtml,
                    overlay
                });
            });

            const targetSelect = overlay.querySelector('#rdTargetSelect');
            targetSelect.addEventListener('change', async () => {
                const tId = targetSelect.value;
                targetSnapshot = tId === '__LIVE__' ? null : await ReportSnapshotStore.getSnapshot(tId);
                this.renderComparison({
                    baselineSnapshot,
                    targetSnapshot,
                    currentHtml,
                    overlay
                });
            });

            // 联动滚动事件
            const paneLeft = overlay.querySelector('#rdPaneLeft');
            const paneRight = overlay.querySelector('#rdPaneRight');
            let isSyncingLeft = false;
            let isSyncingRight = false;

            paneLeft.addEventListener('scroll', () => {
                if (!this.syncScrollEnabled || isSyncingLeft) return;
                isSyncingRight = true;
                const ratio = paneLeft.scrollTop / (paneLeft.scrollHeight - paneLeft.clientHeight || 1);
                paneRight.scrollTop = ratio * (paneRight.scrollHeight - paneRight.clientHeight);
                setTimeout(() => { isSyncingRight = false; }, 50);
            });

            paneRight.addEventListener('scroll', () => {
                if (!this.syncScrollEnabled || isSyncingRight) return;
                isSyncingLeft = true;
                const ratio = paneRight.scrollTop / (paneRight.scrollHeight - paneRight.clientHeight || 1);
                paneLeft.scrollTop = ratio * (paneLeft.scrollHeight - paneLeft.clientHeight);
                setTimeout(() => { isSyncingLeft = false; }, 50);
            });

            const syncBtn = overlay.querySelector('#rdSyncScrollBtn');
            syncBtn.addEventListener('click', () => {
                this.syncScrollEnabled = !this.syncScrollEnabled;
                syncBtn.classList.toggle('report-diff-btn-primary', this.syncScrollEnabled);
            });

            // 差异类型过滤 Tab
            overlay.querySelectorAll('.report-diff-chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    overlay.querySelectorAll('.report-diff-chip').forEach(c => c.classList.remove('active'));
                    chip.classList.add('active');
                    this.activeFilter = chip.dataset.filter || 'all';
                    this.filterDifferences(this.activeFilter);
                });
            });

            // 差异跳转导航
            overlay.querySelector('#rdPrevDiffBtn').addEventListener('click', () => this.navigateDiff(-1));
            overlay.querySelector('#rdNextDiffBtn').addEventListener('click', () => this.navigateDiff(1));

            // 保存并应用到工作区
            overlay.querySelector('#rdApplyAllBtn').addEventListener('click', () => {
                if (typeof onApplyToWorkspace === 'function') {
                    onApplyToWorkspace({
                        rightSheet: overlay.querySelector('#rdRightSheet'),
                        targetSnapshot
                    });
                }
                this.closeModal();
            });

            // 5. 执行初次比对渲染
            this.renderComparison({
                baselineSnapshot,
                targetSnapshot,
                currentHtml,
                overlay
            });
        },

        // 执行比对渲染
        renderComparison({ baselineSnapshot, targetSnapshot, currentHtml, overlay }) {
            const leftSheet = overlay.querySelector('#rdLeftSheet');
            const rightSheet = overlay.querySelector('#rdRightSheet');
            const leftBannerTitle = overlay.querySelector('#rdLeftBannerTitle');
            const rightBannerTitle = overlay.querySelector('#rdRightBannerTitle');

            // 1. 设置左侧基准 HTML
            let baseHtml = '';
            if (baselineSnapshot) {
                baseHtml = baselineSnapshot.payload?.htmlContent ||
                           baselineSnapshot.htmlContent ||
                           (baselineSnapshot.payload ? JSON.stringify(baselineSnapshot.payload) : '');
                leftBannerTitle.textContent = `基准快照：${baselineSnapshot.name}（${baselineSnapshot.month}）`;
            } else {
                baseHtml = '<div style="padding:40px;text-align:center;color:#94a3b8;">暂无选中的基准月报快照。<br>请在上方下拉菜单中选择一份快照，或先保存当前月报为基准快照。</div>';
                leftBannerTitle.textContent = '基准月报：未选择';
            }
            leftSheet.innerHTML = baseHtml;

            // 2. 设置右侧目标 HTML
            let targHtml = '';
            if (targetSnapshot) {
                targHtml = targetSnapshot.payload?.htmlContent ||
                           targetSnapshot.htmlContent ||
                           '';
                rightBannerTitle.textContent = `目标快照：${targetSnapshot.name}（${targetSnapshot.month}）`;
            } else {
                targHtml = currentHtml;
                rightBannerTitle.textContent = '本次最新月报 (可直接编辑修改)';
            }
            rightSheet.innerHTML = targHtml;

            // 3. 执行核心元素匹配与差异提取
            this.differencesList = [];
            this.currentDiffIndex = -1;

            if (baselineSnapshot && (targetSnapshot || currentHtml)) {
                this.executeDiffMatch(leftSheet, rightSheet);
            }

            this.updateStatsCounters(overlay);
        },

        // 匹配两屏对应的文案块、表格与单元格，标注差异
        executeDiffMatch(leftContainer, rightContainer) {
            let diffIdCounter = 0;

            // 辅助函数：根据选择器或 key 进行块级比对
            const compareBlocks = (keyAttr) => {
                const leftBlocks = Array.from(leftContainer.querySelectorAll(`[${keyAttr}]`));
                const rightBlocks = Array.from(rightContainer.querySelectorAll(`[${keyAttr}]`));

                const leftMap = new Map();
                leftBlocks.forEach(el => leftMap.set(el.getAttribute(keyAttr), el));

                rightBlocks.forEach(rightEl => {
                    const key = rightEl.getAttribute(keyAttr);
                    const leftEl = leftMap.get(key);
                    if (!leftEl) return;

                    // A. 文案比对
                    const leftText = leftEl.innerText.trim();
                    const rightText = rightEl.innerText.trim();
                    const textDiff = ReportDiffEngine.diffText(leftText, rightText);

                    // B. 格式与样式比对 (颜色、加粗、高亮)
                    const styleDiff = ReportDiffEngine.diffStyles(leftEl, rightEl);

                    // C. 若有文案差异
                    if (textDiff.hasDiff) {
                        const diffIndex = diffIdCounter++;
                        leftEl.innerHTML = textDiff.baselineHtml;
                        rightEl.innerHTML = textDiff.targetHtml;

                        leftEl.classList.add('report-diff-matched');
                        rightEl.classList.add('report-diff-matched');
                        rightEl.dataset.diffIdx = diffIndex;
                        leftEl.dataset.diffIdx = diffIndex;

                        // 在右侧添加“引用基准”一键还原按钮
                        const applyBtn = document.createElement('button');
                        applyBtn.type = 'button';
                        applyBtn.className = 'report-diff-apply-item-btn';
                        applyBtn.title = '一键采用左侧基准版本的内容与格式';
                        applyBtn.innerHTML = '⇥ 引用基准';
                        applyBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            rightEl.innerHTML = ReportDiffEngine.escapeHtml(leftText);
                            if (leftEl.style.color) rightEl.style.color = leftEl.style.color;
                            if (leftEl.style.fontWeight) rightEl.style.fontWeight = leftEl.style.fontWeight;
                            applyBtn.remove();
                        });
                        rightEl.appendChild(applyBtn);

                        this.differencesList.push({
                            index: diffIndex,
                            type: 'text',
                            leftEl,
                            rightEl,
                            label: `文案差异 (${leftText.slice(0, 10)}...)`
                        });
                    }

                    // D. 若有样式差异（特别凸显：不一致不止文案，也包括格式颜色）
                    if (styleDiff.hasDiff) {
                        const diffIndex = diffIdCounter++;
                        rightEl.classList.add('report-diff-style-changed');
                        rightEl.dataset.styleDiffIdx = diffIndex;

                        styleDiff.items.forEach(st => {
                            const pill = document.createElement('span');
                            pill.className = 'report-diff-style-pill';
                            pill.title = st.label;
                            pill.innerHTML = `🎨 ${ReportDiffEngine.escapeHtml(st.label)}`;
                            rightEl.appendChild(pill);
                        });

                        this.differencesList.push({
                            index: diffIndex,
                            type: 'style',
                            leftEl,
                            rightEl,
                            label: styleDiff.items.map(i => i.label).join(' · ')
                        });
                    }

                    // 允许在右侧原地编辑
                    rightEl.contentEditable = 'true';
                    rightEl.spellcheck = false;
                });
            };

            // 1. 匹配自定义文案键 (data-eos-copy-key 或 data-copy-key)
            compareBlocks('data-eos-copy-key');
            compareBlocks('data-copy-key');

            // 2. 匹配表格与单元格数据变动
            const leftTables = Array.from(leftContainer.querySelectorAll('table'));
            const rightTables = Array.from(rightContainer.querySelectorAll('table'));

            leftTables.forEach((lTable, tIdx) => {
                const rTable = rightTables[tIdx];
                if (!rTable) return;

                const lRows = Array.from(lTable.querySelectorAll('tbody tr'));
                const rRows = Array.from(rTable.querySelectorAll('tbody tr'));

                rRows.forEach((rRow, rIdx) => {
                    const lRow = lRows[rIdx];
                    if (!lRow) {
                        rRow.classList.add('report-diff-row-added');
                        return;
                    }

                    const lCells = Array.from(lRow.querySelectorAll('td, th'));
                    const rCells = Array.from(rRow.querySelectorAll('td, th'));

                    rCells.forEach((rCell, cIdx) => {
                        const lCell = lCells[cIdx];
                        if (!lCell) return;

                        const lVal = lCell.innerText.trim();
                        const rVal = rCell.innerText.trim();
                        if (lVal === rVal) return;

                        // 单元格数据差异
                        const lNum = ReportDiffEngine.parseNumber(lVal);
                        const rNum = ReportDiffEngine.parseNumber(rVal);

                        let deltaHtml = '';
                        if (lNum && rNum) {
                            const delta = rNum.num - lNum.num;
                            const isUp = delta > 0;
                            const sign = isUp ? '+' : '';
                            const suffix = rNum.isPercent ? '%' : '';
                            const formattedDelta = Number.isInteger(delta) ? delta : delta.toFixed(1);
                            deltaHtml = `<span class="report-diff-delta ${isUp ? 'delta-up' : 'delta-down'}">${isUp ? '↑' : '↓'} ${sign}${formattedDelta}${suffix}</span>`;
                        }

                        rCell.classList.add('report-diff-cell-modified');
                        const diffIndex = diffIdCounter++;
                        rCell.dataset.diffIdx = diffIndex;
                        if (deltaHtml) {
                            rCell.innerHTML = `${ReportDiffEngine.escapeHtml(rVal)} ${deltaHtml}`;
                        }

                        this.differencesList.push({
                            index: diffIndex,
                            type: 'data',
                            leftEl: lCell,
                            rightEl: rCell,
                            label: `数据指标变动: ${lVal} ➔ ${rVal}`
                        });

                        // 允许原地编辑表格单元格
                        rCell.contentEditable = 'true';
                    });
                });
            });
        },

        // 更新控制台差异统计
        updateStatsCounters(overlay) {
            const total = this.differencesList.length;
            const textCount = this.differencesList.filter(d => d.type === 'text').length;
            const dataCount = this.differencesList.filter(d => d.type === 'data').length;
            const styleCount = this.differencesList.filter(d => d.type === 'style').length;

            overlay.querySelector('#rdFilterAll').textContent = `全部差异 (${total})`;
            overlay.querySelector('#rdFilterText').textContent = `📝 文案变动 (${textCount})`;
            overlay.querySelector('#rdFilterData').textContent = `📊 数据指标 (${dataCount})`;
            overlay.querySelector('#rdFilterStyle').textContent = `🎨 格式颜色 (${styleCount})`;
            overlay.querySelector('#rdDiffCounter').textContent = total > 0 ? `1 / ${total}` : '0 / 0';

            if (total > 0) {
                this.currentDiffIndex = 0;
                this.highlightCurrentDiff();
            }
        },

        // 过滤差异项展示
        filterDifferences(type) {
            if (!this.activeModal) return;
            const allElements = this.activeModal.querySelectorAll('[data-diff-idx], [data-style-diff-idx]');
            allElements.forEach(el => {
                if (type === 'all') {
                    el.style.opacity = '1';
                } else {
                    const match = this.differencesList.find(d => d.rightEl === el || d.leftEl === el);
                    if (match && match.type === type) {
                        el.style.opacity = '1';
                    } else {
                        el.style.opacity = '0.35';
                    }
                }
            });
        },

        // 差异项前后导航跳转
        navigateDiff(direction) {
            const list = this.activeFilter === 'all'
                ? this.differencesList
                : this.differencesList.filter(d => d.type === this.activeFilter);

            if (!list.length) return;

            this.currentDiffIndex = (this.currentDiffIndex + direction + list.length) % list.length;
            this.highlightCurrentDiff(list);
        },

        highlightCurrentDiff(filteredList) {
            if (!this.activeModal) return;
            const list = filteredList || (this.activeFilter === 'all'
                ? this.differencesList
                : this.differencesList.filter(d => d.type === this.activeFilter));

            if (!list.length || this.currentDiffIndex < 0 || this.currentDiffIndex >= list.length) return;

            const item = list[this.currentDiffIndex];
            this.activeModal.querySelector('#rdDiffCounter').textContent = `${this.currentDiffIndex + 1} / ${list.length}`;

            // 移除旧的高亮
            this.activeModal.querySelectorAll('.report-diff-focused').forEach(el => el.classList.remove('report-diff-focused'));

            // 左右双屏平滑滚动定位
            if (item.leftEl) {
                item.leftEl.classList.add('report-diff-focused');
                item.leftEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            if (item.rightEl) {
                item.rightEl.classList.add('report-diff-focused');
                item.rightEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        },

        closeModal() {
            if (this.activeModal) {
                this.activeModal.remove();
                this.activeModal = null;
                this.differencesList = [];
                this.currentDiffIndex = -1;
            }
        }
    };

    // =========================================================
    // 4. 快照管理库弹窗 (openSnapshotManagerModal)
    // 浏览历史快照、一键恢复、一键比对、重命名、导出与删除
    // =========================================================
    async function openSnapshotManagerModal({
        toolKey,
        topicKey = '',
        onRestoreSnapshot = null,
        onCompareSnapshot = null,
        onSaveNewSnapshot = null
    }) {
        const snapshots = await ReportSnapshotStore.listSnapshots({ toolKey, topicKey });

        const overlay = document.createElement('div');
        overlay.className = 'report-diff-overlay';
        overlay.innerHTML = `
            <div class="report-snapshot-mgr-dialog" role="dialog" aria-modal="true" aria-label="月报快照管理库">
                <div class="report-diff-header">
                    <div class="report-diff-header-top">
                        <div class="report-diff-title-wrap">
                            <h3 class="report-diff-title"><span>📚</span> 月报快照库</h3>
                            <span class="report-diff-subtitle">管理保存在服务器与多设备同步的历史月报快照</span>
                        </div>
                        <div class="report-diff-top-actions">
                            <button type="button" class="report-diff-btn report-diff-btn-primary" id="smNewSnapshotBtn">
                                <span>📸</span> 保存当前为新快照
                            </button>
                            <button type="button" class="report-diff-btn-close" id="smCloseBtn">×</button>
                        </div>
                    </div>
                </div>

                <div class="report-snapshot-mgr-list" id="smListContainer">
                    ${!snapshots.length ? `
                        <div style="padding:40px;text-align:center;color:#94a3b8;">
                            暂无已保存的月报快照。<br>点击上方「📸 保存当前为新快照」即可将当前月报永久备份。
                        </div>
                    ` : snapshots.map(item => `
                        <div class="report-snapshot-item" data-snapshot-id="${ReportDiffEngine.escapeHtml(item.id)}">
                            <div class="report-snapshot-item-info">
                                <div class="report-snapshot-item-title">
                                    <span>📄 ${ReportDiffEngine.escapeHtml(item.name)}</span>
                                    <span class="report-diff-pane-badge badge-baseline">${ReportDiffEngine.escapeHtml(item.month)}</span>
                                </div>
                                <div class="report-snapshot-item-meta">
                                    保存时间：${new Date(item.updatedAt || item.createdAt).toLocaleString('zh-CN')}
                                </div>
                            </div>
                            <div class="report-snapshot-item-actions">
                                <button type="button" class="report-diff-btn report-diff-btn-primary sm-compare-btn" title="将此快照与当前月报在分屏中进行智能比对">
                                    <span>🔍</span> 对比
                                </button>
                                <button type="button" class="report-diff-btn sm-restore-btn" title="将此快照数据与定制文案完整恢复至当前工作区">
                                    <span>📖</span> 读取
                                </button>
                                <button type="button" class="report-diff-btn sm-rename-btn" title="重命名此快照">
                                    <span>✏️</span>
                                </button>
                                <button type="button" class="report-diff-btn sm-delete-btn" style="color:#ef4444;" title="从服务器删除此快照">
                                    <span>🗑️</span>
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.querySelector('#smCloseBtn').addEventListener('click', close);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });

        // 新建快照
        overlay.querySelector('#smNewSnapshotBtn').addEventListener('click', async () => {
            if (typeof onSaveNewSnapshot === 'function') {
                close();
                await onSaveNewSnapshot();
            }
        });

        // 列表操作委托绑定
        overlay.querySelector('#smListContainer').addEventListener('click', async (e) => {
            const itemEl = e.target.closest('.report-snapshot-item');
            if (!itemEl) return;
            const id = itemEl.dataset.snapshotId;

            // 比对
            if (e.target.closest('.sm-compare-btn')) {
                close();
                if (typeof onCompareSnapshot === 'function') {
                    onCompareSnapshot(id);
                }
            }
            // 读取恢复
            else if (e.target.closest('.sm-restore-btn')) {
                if (await AppDialog.confirm('确定将此快照恢复到当前工作区吗？当前未保存的临时输入可能会被覆盖。', { title: '恢复快照', confirmText: '恢复' })) {
                    close();
                    if (typeof onRestoreSnapshot === 'function') {
                        const fullSnap = await ReportSnapshotStore.getSnapshot(id);
                        onRestoreSnapshot(fullSnap);
                    }
                }
            }
            // 重命名
            else if (e.target.closest('.sm-rename-btn')) {
                const currentName = (itemEl.querySelector('.report-snapshot-item-title span')?.textContent || '').replace(/^📄\s*/, '').trim();
                const newName = await AppDialog.prompt('请输入快照新名称：', { title: '重命名快照', label: '快照名称', defaultValue: currentName, maxLength: 120, confirmText: '保存' });
                if (newName && newName.trim()) {
                    await ReportSnapshotStore.renameSnapshot(id, newName.trim());
                    close();
                    openSnapshotManagerModal({ toolKey, topicKey, onRestoreSnapshot, onCompareSnapshot, onSaveNewSnapshot });
                }
            }
            // 删除
            else if (e.target.closest('.sm-delete-btn')) {
                if (await AppDialog.confirm('确定从服务器永久删除此份快照吗？', { title: '删除快照', tone: 'danger', confirmText: '删除' })) {
                    await ReportSnapshotStore.deleteSnapshot(id);
                    itemEl.remove();
                }
            }
        });
    }

    return {
        Store: ReportSnapshotStore,
        Engine: ReportDiffEngine,
        Viewer: ReportDiffViewer,
        openSnapshotManager: openSnapshotManagerModal
    };
}));
