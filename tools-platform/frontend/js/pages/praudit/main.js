        let ALL_CONFIGS = [];
        let activeConfig = null;

        let ALL_FIELDS = [];
        let CHECK_POINTS = [];
        let STORAGE_KEY_DATA = '';
        let STORAGE_KEY_COLS = '';
        let activeWorkspace = null;

        let ordersData = [];
        let visibleCols = [];
        let pendingReasonTarget = null;
        let pendingImportBatch = null;
        let selectedSampleCount = 0;
        const PR_AUDIT_WORKSPACES_KEY = 'PR_Auditor_Workspaces_V1';

        window.onload = async function () {
            await loadConfigs();
            initFloatingTableHeader();
            document.addEventListener('keydown', handleGlobalModalShortcuts);
        };

        function createAuditWorkspaceId(prefix = 'ws') {
            return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        }

        function getWorkspaceDataKey(workspaceId) {
            return `PR_Auditor_Workspace_Data_${workspaceId}`;
        }

        function getWorkspaceColsKey(workspaceId) {
            return `PR_Auditor_Workspace_Cols_${workspaceId}`;
        }

        function getLegacyConfigDataKey(configId) {
            return `PR_Auditor_Data_${configId}`;
        }

        function getLegacyConfigColsKey(configId) {
            return `PR_Auditor_Cols_${configId}`;
        }

        function readAuditWorkspaceMap() {
            try {
                const raw = JSON.parse(localStorage.getItem(PR_AUDIT_WORKSPACES_KEY) || '{}');
                return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
            } catch (e) {
                console.warn('[PR Audit Workspace] 读取工作区映射失败，已回退为空映射', e);
                return {};
            }
        }

        function writeAuditWorkspaceMap(map) {
            localStorage.setItem(PR_AUDIT_WORKSPACES_KEY, JSON.stringify(map || {}));
        }

        function saveAuditWorkspaceForConfig(configId, workspace) {
            if (!configId || !workspace || !workspace.id) return;
            const map = readAuditWorkspaceMap();
            map[configId] = {
                id: workspace.id,
                name: workspace.name || '',
                templateId: workspace.templateId || configId,
                templateName: workspace.templateName || '',
                batchId: workspace.batchId || '',
                mergeKey: workspace.mergeKey || '',
                scope: workspace.scope || 'template-local',
                groupField: workspace.groupField || '',
                groupValue: workspace.groupValue || '',
                groupIndex: workspace.groupIndex || 0,
                groupCount: workspace.groupCount || 0,
                createdAt: workspace.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            writeAuditWorkspaceMap(map);
        }

        function removeAuditWorkspaceForConfig(configId) {
            if (!configId) return;
            const map = readAuditWorkspaceMap();
            delete map[configId];
            writeAuditWorkspaceMap(map);
        }

        function getAuditWorkspaceForConfig(config) {
            const configId = config && config.id ? String(config.id) : '';
            const map = readAuditWorkspaceMap();
            const saved = configId ? map[configId] : null;
            if (saved && saved.id) return { ...saved };
            return {
                id: configId || createAuditWorkspaceId('template'),
                name: config && config.name ? `${config.name} 工作区` : 'PR Audit Workspace',
                templateId: configId,
                templateName: config && config.name ? config.name : '',
                batchId: '',
                mergeKey: '',
                scope: 'template-local',
                groupField: config && config.groupField ? config.groupField : '',
                groupValue: '',
                groupIndex: 0,
                groupCount: 0,
                createdAt: new Date().toISOString()
            };
        }

        function renderActiveWorkspaceInfo() {
            const el = document.getElementById('workspaceInfoText');
            if (!el) return;
            if (!activeConfig || !activeWorkspace) {
                el.textContent = tText('当前工作区：-', 'Current workspace: -');
                return;
            }
            const scopeLabelMap = {
                'template-local': tText('本地模板工作区', 'Local template workspace'),
                'all': tText('全量工作区', 'Full workspace'),
                'group': tText('分组工作区', 'Grouped workspace'),
                'merged-import': tText('合并导入工作区', 'Merged import workspace')
            };
            const scopeLabel = scopeLabelMap[activeWorkspace.scope] || activeWorkspace.scope || tText('工作区', 'Workspace');
            const groupLabel = activeWorkspace.groupField && activeWorkspace.groupValue
                ? tText(` | 分组：${activeWorkspace.groupField} = ${activeWorkspace.groupValue}`, ` | Group: ${activeWorkspace.groupField} = ${activeWorkspace.groupValue}`)
                : '';
            el.textContent = tText(
                `当前工作区：${activeWorkspace.name || '-'} | 作用域：${scopeLabel}${groupLabel}`,
                `Current workspace: ${activeWorkspace.name || '-'} | Scope: ${scopeLabel}${groupLabel}`
            );
            el.title = el.textContent;
        }

        function handleGlobalModalShortcuts(event) {
            if (event.key !== 'Escape') return;
            const closableModalIds = ['imageModal', 'reasonModal', 'sampleModal', 'wizardModal', 'configModal', 'detailModal', 'importModal'];
            const openedModalId = closableModalIds.find(id => {
                const el = document.getElementById(id);
                return el && el.style.display === 'flex';
            });
            if (!openedModalId) return;
            closeModal(openedModalId);
        }

        async function loadConfigs() {
            try {
                const res = await API.get('/api/praudit/configs');
                ALL_CONFIGS = res || [];

                const selector = document.getElementById('auditTypeSelector');
                selector.innerHTML = '';

                if (ALL_CONFIGS.length === 0) {
                    selector.innerHTML = `<option value="">${tText('无可用模板', 'No templates available')}</option>`;
                    return;
                }

                ALL_CONFIGS.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.id;
                    opt.innerText = c.name;
                    selector.appendChild(opt);
                });

                const lastSelected = localStorage.getItem('PR_Auditor_LastConfigId');
                if (lastSelected && ALL_CONFIGS.find(c => c.id === lastSelected)) {
                    selector.value = lastSelected;
                }
                await switchAuditType();
            } catch (e) {
                AppDialog.alert("加载审计模板失败：" + e.message, { title: "加载失败", tone: "error" });
            }
        }

        async function switchAuditType() {
            const selector = document.getElementById('auditTypeSelector');
            const configId = selector.value;
            if (!configId) return;

            activeConfig = ALL_CONFIGS.find(c => c.id === configId);
            localStorage.setItem('PR_Auditor_LastConfigId', configId);
            activeWorkspace = getAuditWorkspaceForConfig(activeConfig);
            renderActiveWorkspaceInfo();

            ALL_FIELDS = activeConfig.fields;
            CHECK_POINTS = activeConfig.checkpoints;
            STORAGE_KEY_DATA = getWorkspaceDataKey(activeWorkspace.id);
            STORAGE_KEY_COLS = getWorkspaceColsKey(activeWorkspace.id);

            try {
                let localData = null;
                if (window.__PRAUDIT_OFFLINE__) {
                    const localMirror = localStorage.getItem(STORAGE_KEY_DATA);
                    if (localMirror) {
                        localData = JSON.parse(localMirror);
                        localforage.setItem(STORAGE_KEY_DATA, localData).catch(err => {
                            console.warn('离线工作区镜像回写 IndexedDB 失败:', err);
                        });
                    }
                }
                if (!localData) {
                    localData = await localforage.getItem(STORAGE_KEY_DATA);
                }

                // 兼容老版本 localStorage / IndexedDB 数据，首次读取后迁移到工作区键。
                if (!localData) {
                    const oldLocalData = localStorage.getItem(STORAGE_KEY_DATA);
                    if (oldLocalData) {
                        localData = JSON.parse(oldLocalData);
                        await localforage.setItem(STORAGE_KEY_DATA, localData);
                        if (!window.__PRAUDIT_OFFLINE__) {
                            localStorage.removeItem(STORAGE_KEY_DATA); // 清理旧存储
                        }
                    }
                }
                if (!localData) {
                    const legacyDataKey = getLegacyConfigDataKey(configId);
                    localData = await localforage.getItem(legacyDataKey);
                    if (!localData) {
                        const oldLocalData = localStorage.getItem(legacyDataKey);
                        if (oldLocalData) localData = JSON.parse(oldLocalData);
                    }
                    if (localData) {
                        await localforage.setItem(STORAGE_KEY_DATA, localData);
                        saveAuditWorkspaceForConfig(configId, activeWorkspace);
                    }
                }

                if (localData) {
                    ordersData = localData;
                    ordersData.forEach(row => {
                        if (!row.reasons) row.reasons = {};
                        if (!row.checks) row.checks = {};
                        if (!row.images) row.images = {};
                        CHECK_POINTS.forEach(cp => {
                            if (!row.reasons[cp.key]) row.reasons[cp.key] = '';
                            if (!row.checks[cp.key]) row.checks[cp.key] = 'none';
                            if (!row.images[cp.key]) row.images[cp.key] = '';
                        });
                    });
                } else {
                    ordersData = [];
                }
            } catch (e) {
                console.error("加载数据失败", e);
                ordersData = [];
            }

            let localCols = localStorage.getItem(STORAGE_KEY_COLS);
            if (!localCols) {
                localCols = localStorage.getItem(getLegacyConfigColsKey(configId));
                if (localCols) localStorage.setItem(STORAGE_KEY_COLS, localCols);
            }
            if (localCols) {
                visibleCols = JSON.parse(localCols);
                visibleCols = visibleCols.filter(c => ALL_FIELDS.includes(c));
            } else {
                visibleCols = ALL_FIELDS.slice(0, Math.min(4, ALL_FIELDS.length));
            }
            if (visibleCols.length === 0 && ALL_FIELDS.length > 0) visibleCols = [ALL_FIELDS[0]];

            // 控制编辑按钮显示
            const editBtn = document.getElementById('btnEditConfig');
            const delBtn = document.getElementById('btnDeleteConfig');
            if (editBtn) {
                editBtn.style.display = (activeConfig && activeConfig.id !== 'rc_audit_default') ? 'inline-block' : 'none';
            }
            if (delBtn) {
                delBtn.style.display = (activeConfig && activeConfig.id !== 'rc_audit_default') ? 'inline-block' : 'none';
            }

            initColConfig();

            // Re-apply toggleLang logic to newly rendered tables if needed
            if (typeof renderTable === 'function') {
                renderTable();
            }
        }

        function saveToStorage() {
            if (!STORAGE_KEY_DATA) return;
            const cloned = JSON.parse(JSON.stringify(ordersData));
            if (activeConfig && activeWorkspace) {
                saveAuditWorkspaceForConfig(activeConfig.id, activeWorkspace);
            }
            if (window.__PRAUDIT_OFFLINE__) {
                try {
                    localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(cloned));
                } catch (e) {
                    console.warn("离线 localStorage 镜像写入失败:", e);
                }
            }
            // 异步非阻塞存储，极大提升流畅度且无 5MB 限制
            localforage.setItem(STORAGE_KEY_DATA, cloned).catch(e => {
                console.error("IndexedDB 写入失败:", e);
                AppDialog.alert("保存失败：本地数据库异常，请检查浏览器是否禁用了 IndexedDB。", { title: "保存失败", tone: "error" });
            });
        }

        function escapeHtmlText(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function escapeJsString(value) {
            return String(value ?? '')
                .replace(/\\/g, '\\\\')
                .replace(/'/g, "\\'")
                .replace(/\r?\n/g, '\\n');
        }

        function getFloatingHeaderTop() {
            const raw = getComputedStyle(document.documentElement).getPropertyValue('--navbar-h') || '0';
            const navbarHeight = Number.parseFloat(raw) || 0;
            return navbarHeight + 4;
        }

        function updateFloatingTableHeader() {
            const container = document.querySelector('.table-container');
            const table = document.getElementById('mainTable');
            const thead = document.getElementById('tableHead');
            const floating = document.getElementById('floatingTableHeader');
            if (!container || !table || !thead || !floating || !thead.children.length) return;

            const tableRect = table.getBoundingClientRect();
            const theadRect = thead.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const top = getFloatingHeaderTop();
            const shouldShow = theadRect.bottom < top && tableRect.bottom > top + thead.offsetHeight;

            if (!shouldShow) {
                floating.style.display = 'none';
                return;
            }

            const originalCells = Array.from(thead.querySelectorAll('th'));
            const clonedHead = thead.cloneNode(true);
            const clonedCells = Array.from(clonedHead.querySelectorAll('th'));
            clonedCells.forEach((cell, idx) => {
                const width = originalCells[idx] ? originalCells[idx].getBoundingClientRect().width : 100;
                cell.style.width = `${width}px`;
                cell.style.minWidth = `${width}px`;
                cell.style.maxWidth = `${width}px`;
            });

            floating.innerHTML = '';
            const cloneTable = document.createElement('table');
            cloneTable.style.width = `${table.getBoundingClientRect().width}px`;
            cloneTable.style.transform = `translateX(${-container.scrollLeft}px)`;
            cloneTable.appendChild(clonedHead);
            floating.appendChild(cloneTable);

            const currentGroup = getCurrentFloatingGroup(top + thead.offsetHeight);
            const groupBar = document.createElement('div');
            groupBar.className = 'floating-group-header';
            if (currentGroup) {
                const groupPrefix = currentLang === 'en' ? 'Group' : '分组';
                const groupUnit = currentLang === 'en' ? 'items' : '条';
                groupBar.style.display = 'block';
                groupBar.innerText = `${groupPrefix}：${currentGroup.field} = ${currentGroup.value} （${currentGroup.count} ${groupUnit}）`;
            }
            floating.appendChild(groupBar);

            floating.style.display = 'block';
            floating.style.left = `${containerRect.left}px`;
            floating.style.top = `${top}px`;
            floating.style.width = `${containerRect.width}px`;
            floating.style.transform = 'none';
            floating.style.height = 'auto';
        }

        function getCurrentFloatingGroup(anchorY) {
            const groupRows = Array.from(document.querySelectorAll('.audit-group-row'));
            if (!groupRows.length) return null;
            let current = null;
            groupRows.forEach(row => {
                const rect = row.getBoundingClientRect();
                if (rect.top <= anchorY) current = row;
            });
            if (!current) return null;
            return {
                field: current.dataset.groupField || '',
                value: current.dataset.groupValue || '',
                count: current.dataset.groupCount || '0'
            };
        }

        function initFloatingTableHeader() {
            const container = document.querySelector('.table-container');
            window.addEventListener('scroll', updateFloatingTableHeader, { passive: true });
            window.addEventListener('resize', updateFloatingTableHeader);
            if (container) container.addEventListener('scroll', updateFloatingTableHeader, { passive: true });
            setTimeout(updateFloatingTableHeader, 0);
        }

        // ================== 表格渲染引擎 ==================
        function renderTable() {
            const thead = document.getElementById('tableHead');
            const tbody = document.getElementById('tableBody');
            const colspan = visibleCols.length + CHECK_POINTS.length + 2;

            let headHtml = `<tr>`;
            visibleCols.forEach(col => { headHtml += `<th>${col}</th>`; });
            CHECK_POINTS.forEach(cp => {
                const name = escapeHtmlText(cp.name || '-');
                const nameEn = escapeHtmlText(cp.nameEn || cp.name || '-');
                const desc = escapeHtmlText(cp.desc || '-');
                const descEn = escapeHtmlText(cp.descEn || cp.desc || '-');
                headHtml += `
                    <th class="check-header">
                        <span class="check-header-title">${name}</span>
                        <span class="check-header-title-en">${nameEn}</span>
                        <span class="check-header-desc">${desc}<br>${descEn}</span>
                    </th>
                `;
            });
            headHtml += `<th style="width: 100px;">${tText('自检状态', 'Status')}</th><th style="width: 80px;">${tText('操作', 'Actions')}</th></tr>`;
            thead.innerHTML = headHtml;

            tbody.innerHTML = '';
            if (ordersData.length === 0) {
                tbody.innerHTML = `<tr><td colspan="${colspan}" style="color:#999; padding:30px;">暂无自检数据，请点击上方“导入 Excel 文件”开始。</td></tr>`;
                return;
            }

            const groupField = activeConfig && activeConfig.groupField && ALL_FIELDS.includes(activeConfig.groupField)
                ? activeConfig.groupField
                : '';
            const groupCounts = groupField ? ordersData.reduce((acc, row) => {
                const key = (row.baseData && row.baseData[groupField]) ? row.baseData[groupField] : '未填写';
                acc[key] = (acc[key] || 0) + 1;
                return acc;
            }, {}) : {};
            let lastGroupValue = null;
            const displayRows = ordersData.map((row, rowIndex) => ({ row, rowIndex }));
            if (groupField) {
                displayRows.sort((a, b) => {
                    const av = (a.row.baseData && a.row.baseData[groupField]) ? a.row.baseData[groupField] : '未填写';
                    const bv = (b.row.baseData && b.row.baseData[groupField]) ? b.row.baseData[groupField] : '未填写';
                    return String(av).localeCompare(String(bv), 'zh-CN');
                });
            }

            displayRows.forEach(({ row, rowIndex }) => {
                if (groupField) {
                    const groupValue = (row.baseData && row.baseData[groupField]) ? row.baseData[groupField] : '未填写';
                    if (groupValue !== lastGroupValue) {
                        const groupTr = document.createElement('tr');
                        groupTr.className = 'audit-group-row';
                        groupTr.dataset.groupField = groupField;
                        groupTr.dataset.groupValue = groupValue;
                        groupTr.dataset.groupCount = String(groupCounts[groupValue] || 0);
                        const groupPrefix = typeof currentLang !== 'undefined' && currentLang === 'en' ? 'Group' : '分组';
                        const groupUnit = typeof currentLang !== 'undefined' && currentLang === 'en' ? 'items' : '条';
                        groupTr.innerHTML = `<td colspan="${colspan}">${groupPrefix}：${escapeHtmlText(groupField)} = ${escapeHtmlText(groupValue)} （${groupCounts[groupValue]} ${groupUnit}）</td>`;
                        tbody.appendChild(groupTr);
                        lastGroupValue = groupValue;
                    }
                }

                const tr = document.createElement('tr');
                let status = 'pass';

                for (let i = 0; i < CHECK_POINTS.length; i++) {
                    const cKey = CHECK_POINTS[i].key;
                    if (row.checks[cKey] === 'fail') { status = 'fail'; break; }
                    if (row.checks[cKey] === 'none') { status = 'wait'; }
                }

                let htmlStr = '';

                visibleCols.forEach(col => {
                    let val = row.baseData[col] || '-';
                    // 默认 ALL_FIELDS[0] 是唯一主键/任务号
                    if (ALL_FIELDS.length > 0 && col === ALL_FIELDS[0]) {
                        htmlStr += `<td><span class="task-id-cell" title="点击一键复制" onclick="copyText('${val}')">${val}</span></td>`;
                    } else {
                        if (val.length > 15) val = `<span title="${val}">${val.substring(0, 15)}...</span>`;
                        htmlStr += `<td>${val}</td>`;
                    }
                });

                // 检查点列
                CHECK_POINTS.forEach(cp => {
                    const cKey = cp.key;
                    const state = row.checks[cKey];
                    const reason = row.reasons[cKey];
                    const imgStr = row.images[cKey];

                    const reasonLabel = currentLang === 'en' ? 'Reason' : '理由';
                    const evidenceLabel = currentLang === 'en' ? 'Evidence' : '证据';
                    const passText = currentLang === 'en' ? 'Pass' : '通过';
                    const failText = currentLang === 'en' ? 'Fail' : '未过';
                    const reasonText = state === 'fail' && reason ? reason : (currentLang === 'en' ? 'None' : '无');
                    const reasonClass = state === 'fail' && reason ? '' : ' empty';
                    const reasonHtml = `<div class="fail-reason-tag${reasonClass}" title="${reasonLabel}: ${escapeHtmlText(reasonText)}">${reasonLabel}：${escapeHtmlText(reasonText)}</div>`;

                    const evidenceText = imgStr
                        ? (currentLang === 'en' ? 'Evidence attached' : '已附截图证据')
                        : (currentLang === 'en' ? 'No evidence' : '未附截图');
                    const evidenceClass = imgStr ? ' has-image' : '';
                    const evidenceHtml = `<div class="evidence-status-tag${evidenceClass}" title="${evidenceLabel}: ${evidenceText}">${evidenceLabel}：${evidenceText}</div>`;

                    htmlStr += `
                    <td>
                        <div class="checkpoint-cell">
                            <div class="toggle-group">
                                <button class="btn-chk pass ${state === 'pass' ? 'active' : ''}" onclick="setCheck('${cKey}', ${rowIndex}, 'pass')">✔${passText}</button>
                                <button class="btn-chk fail ${state === 'fail' ? 'active' : ''}" onclick="setCheck('${cKey}', ${rowIndex}, 'fail')">✘${failText}</button>
                            </div>
                            ${reasonHtml}
                            ${evidenceHtml}
                        </div>
                    </td>
                `;
                });

                let statusBadge = status === 'pass' ? '<span class="badge badge-pass">✅ 合格</span>' :
                    (status === 'fail' ? '<span class="badge badge-fail">❌ 不合格</span>' : '<span class="badge badge-wait">⏳ 待检</span>');

                const strPassAll = typeof currentLang !== 'undefined' && currentLang === 'en' ? '✔Pass All' : '✔全过';
                const strFailAll = typeof currentLang !== 'undefined' && currentLang === 'en' ? '✘Fail All' : '✘全挂';
                const strDetail = typeof currentLang !== 'undefined' && currentLang === 'en' ? 'Detail' : '详情';
                const strDelete = typeof currentLang !== 'undefined' && currentLang === 'en' ? 'Delete' : '删除';

                htmlStr += `<td>${statusBadge}</td>
                        <td>
                            <div class="action-cell" style="display:flex; flex-direction:column; gap:4px;">
                                <button class="btn-success" style="padding: 4px; font-size:0.75rem; width:100%; box-shadow:none;" onclick="passAll(${rowIndex})">${strPassAll}</button>
                                <button class="btn-warning" style="padding: 4px; font-size:0.75rem; width:100%; box-shadow:none; color:#fff;" onclick="failAll(${rowIndex})">${strFailAll}</button>
                                <button class="btn-outline" style="padding: 4px; font-size:0.75rem; width:100%;" onclick="openDetail(${rowIndex})">${strDetail}</button>
                                <button class="btn-danger" style="padding: 4px; font-size:0.75rem; width:100%; box-shadow:none;" onclick="removeRow(${rowIndex})">${strDelete}</button>
                            </div>
                        </td>`;
                tr.innerHTML = htmlStr;
                tbody.appendChild(tr);
            });
        }

        // ================== 一键复制与Toast提示 ==================
        let toastTimer;
        function copyText(text) {
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(text).then(() => showToast(tText(`任务号 ${text} 复制成功！`, `Ticket ${text} copied successfully!`)));
            } else {
                let textArea = document.createElement("textarea");
                textArea.value = text;
                textArea.style.position = "fixed"; textArea.style.left = "-999999px";
                document.body.appendChild(textArea); textArea.select();
                try { document.execCommand('copy'); showToast(tText(`任务号 ${text} 复制成功！`, `Ticket ${text} copied successfully!`)); } catch (err) { showToast(tText('复制失败，请手动复制。', 'Copy failed, please copy it manually.')); }
                textArea.remove();
            }
        }

        function showToast(msg) {
            const toast = document.getElementById('toastMsg');
            toast.innerText = msg; toast.style.opacity = '1'; toast.style.transform = 'translate(-50%, 10px)';
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translate(-50%, 0)'; }, 2000);
        }

        function restoreI18nButtonLabel(btn, zhKey, enText) {
            if (!btn) return;
            btn.innerHTML = `<span data-i18n="${escapeHtmlText(zhKey)}">${currentLang === 'en' ? enText : zhKey}</span>`;
        }

        function logTemplateSaveStep(message, payload = null) {
            const prefix = '[PR Audit Template Save]';
            if (payload === null || payload === undefined) console.log(prefix, message);
            else console.log(prefix, message, payload);
        }

        async function fetchTemplateSaveDiagnostics(configId) {
            const configs = await API.get('/api/praudit/configs');
            const matched = (configs || []).find(item => item.id === configId) || null;
            return {
                configCount: Array.isArray(configs) ? configs.length : 0,
                matched
            };
        }

        function toggleWizardCollapse(contentId) {
            const content = document.getElementById(contentId);
            if (!content) return;
            content.dataset.expanded = content.dataset.expanded === 'true' ? 'false' : 'true';
            refreshWizardCollapse(contentId);
        }

        function refreshWizardCollapse(contentId) {
            const content = document.getElementById(contentId);
            const toggle = document.getElementById(`${contentId}Toggle`);
            const fade = document.getElementById(`${contentId}Fade`);
            if (!content || !toggle || !fade) return;

            let collapseHeight = Number(content.dataset.collapseHeight || 124);
            const collapseRows = Number(content.dataset.collapseRows || 0);
            if (collapseRows > 0) {
                const items = Array.from(content.children).filter(node => node.nodeType === 1);
                const rowTops = [...new Set(items.map(item => item.offsetTop))].sort((a, b) => a - b);
                if (rowTops.length > collapseRows) {
                    const visibleRowTops = rowTops.slice(0, collapseRows);
                    const visibleRowBottom = items
                        .filter(item => visibleRowTops.includes(item.offsetTop))
                        .reduce((maxBottom, item) => Math.max(maxBottom, item.offsetTop + item.offsetHeight), 0);
                    if (visibleRowBottom > 0) collapseHeight = Math.max(collapseHeight, visibleRowBottom + 12);
                }
            }
            const shouldCollapse = content.scrollHeight > collapseHeight + 8;
            const expanded = content.dataset.expanded === 'true';
            const expandMode = content.dataset.expandMode || 'scroll';
            content.style.setProperty('--collapse-height', `${collapseHeight}px`);

            if (!shouldCollapse) {
                content.classList.remove('is-collapsed', 'is-expanded', 'no-inner-scroll');
                content.scrollTop = 0;
                toggle.classList.remove('visible');
                fade.classList.remove('visible');
                content.dataset.expanded = 'false';
                return;
            }

            if (!expanded) content.scrollTop = 0;
            content.classList.toggle('is-collapsed', !expanded);
            content.classList.toggle('is-expanded', expanded);
            content.classList.toggle('no-inner-scroll', expanded && expandMode === 'full');
            toggle.classList.add('visible');
            fade.classList.toggle('visible', !expanded);
            toggle.innerText = expanded
                ? tText('收起', 'Collapse')
                : tText('展开更多', 'Expand');
        }

        function refreshWizardCollapsibleSections() {
            requestAnimationFrame(() => {
                refreshWizardCollapse('wizFieldsGrid');
                refreshWizardCollapse('wizReportFieldsBox');
            });
        }

        // ================== 状态设定与理由拦截 ==================
        function setCheck(cKey, rowIndex, value) {
            const currentState = ordersData[rowIndex].checks[cKey];
            if (currentState === value) {
                ordersData[rowIndex].checks[cKey] = 'none'; ordersData[rowIndex].reasons[cKey] = '';
                saveToStorage(); renderTable(); return;
            }

            if (value === 'fail') {
                pendingReasonTarget = { cKey, rowIndex };
                activeUploadTarget = { cKey, rowIndex };
                document.getElementById('reasonInput').value = ordersData[rowIndex].reasons[cKey] || '';
                renderReasonTemplates();
                renderReasonEvidence();
                openModal('reasonModal');
                setTimeout(() => document.getElementById('reasonInput').focus(), 100);
                return;
            }

            ordersData[rowIndex].checks[cKey] = 'pass'; ordersData[rowIndex].reasons[cKey] = '';
            saveToStorage(); renderTable();
        }

        function renderReasonTemplates() {
            const box = document.getElementById('reasonTemplatesBox');
            if (!box) return;
            const cpKey = pendingReasonTarget ? pendingReasonTarget.cKey : '';
            const reasonTemplateMap = normalizeReasonTemplates(activeConfig && activeConfig.reasonTemplates ? activeConfig.reasonTemplates : {});
            const templates = reasonTemplateMap[cpKey] || [];
            if (!templates.length) {
                box.innerHTML = `<span style="font-size:12px; color:#888;">${tText('当前检查点未配置快捷理由，可直接手动填写。', 'No shortcut reasons are configured for this checkpoint. You can type one manually.')}</span>`;
                return;
            }
            box.innerHTML = templates.map(reason => `
                <button type="button" class="reason-template-chip" onclick="applyReasonTemplate('${escapeJsString(reason)}')">${escapeHtmlText(reason)}</button>
            `).join('');
        }

        function applyReasonTemplate(reason) {
            const input = document.getElementById('reasonInput');
            if (!input) return;
            input.value = reason;
            input.focus();
        }

        function normalizeReasonTemplates(value) {
            if (Array.isArray(value)) {
                const fallback = value.map(v => String(v || '').trim()).filter(Boolean);
                const map = {};
                CHECK_POINTS.forEach(cp => { map[cp.key] = fallback; });
                return map;
            }
            if (!value || typeof value !== 'object') return {};
            return Object.keys(value).reduce((acc, key) => {
                acc[key] = Array.isArray(value[key])
                    ? value[key].map(v => String(v || '').trim()).filter(Boolean)
                    : [];
                return acc;
            }, {});
        }

        function confirmReason() {
            if (!pendingReasonTarget) return;
            const text = document.getElementById('reasonInput').value.trim();
            if (!text) { showToast("未通过必须填写理由！"); document.getElementById('reasonInput').focus(); return; }
            const { cKey, rowIndex } = pendingReasonTarget;
            ordersData[rowIndex].checks[cKey] = 'fail'; ordersData[rowIndex].reasons[cKey] = text;
            saveToStorage(); renderTable(); closeModal('reasonModal'); pendingReasonTarget = null; activeUploadTarget = null;
        }

        function cancelReason() { closeModal('reasonModal'); pendingReasonTarget = null; activeUploadTarget = null; }

        // ================== 高级 PDF 导出引擎 (双语及完美换行/排版适配) ==================
        function getActiveAuditGroupField() {
            return activeConfig && activeConfig.groupField && ALL_FIELDS.includes(activeConfig.groupField)
                ? activeConfig.groupField
                : '';
        }

        function getAuditGroupValue(row, groupField) {
            return row && row.baseData && row.baseData[groupField] ? row.baseData[groupField] : '未填写';
        }

        function buildAuditGroups(rows, groupField) {
            if (!groupField) return [{ value: '', rows: rows.slice() }];
            const map = new Map();
            rows.forEach(row => {
                const value = getAuditGroupValue(row, groupField);
                if (!map.has(value)) map.set(value, []);
                map.get(value).push(row);
            });
            return Array.from(map.entries())
                .sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'zh-CN'))
                .map(([value, groupRows]) => ({ value, rows: groupRows }));
        }

        function exportPDF(options = {}) {
            const sourceRows = options.rows || ordersData;
            if (sourceRows.length === 0) { showToast("没有可导出的数据！"); return; }
            const reportDiv = document.getElementById('printReport');
            const dateStr = new Date().toLocaleString('zh-CN', { hour12: false });

            const title = activeConfig ? activeConfig.name : 'PR进展自检审计报告';
            const groupField = options.groupField !== undefined ? options.groupField : getActiveAuditGroupField();
            const groupValue = options.groupValue || '';

            const escapeHtml = (value) => String(value ?? '-')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');

            const FIELD_EN_LABELS = {
                '标题': 'Title',
                '处理人': 'Owner',
                '任务状态': 'Task Status',
                '是否延期': 'Delayed',
                '作业单号': 'Ticket ID',
                '场景': 'Request Type',
                '子场景': 'Operation',
                '客户群': 'Customer Group',
                '产品线': 'Product Line',
                '产品': 'Product',
                '区域': 'Region',
                '国家': 'Country',
                '状态': 'Status',
                '级别': 'Level',
                '创建时间': 'Created Time',
                '关闭时间': 'Closed Time'
            };

            const getFieldEnLabel = (field) => FIELD_EN_LABELS[field] || field;
            const renderBilingualLabel = (zh, en, options = {}) => {
                const zhText = escapeHtml(zh || '-');
                const enText = escapeHtml(en || zh || '-');
                if (options.inline) return `${zhText} / ${enText}`;
                return `${zhText}<br><span style="font-size:10px; color:#555; font-weight:400;">${enText}</span>`;
            };
            const renderCheckpointLabel = (cp, options = {}) => renderBilingualLabel(cp.name, cp.nameEn || cp.name, options);
            const renderFieldLabel = (field) => renderBilingualLabel(field, getFieldEnLabel(field));
            const primaryField = ALL_FIELDS[0] || '';
            const getRowPrimaryLabel = (row) => {
                const value = row && row.baseData && primaryField ? row.baseData[primaryField] : '';
                return String(row.id || value || '-');
            };

            let total = sourceRows.length;
            let passCount = 0; let failCount = 0; let waitCount = 0;
            let cpFailCounts = {};
            CHECK_POINTS.forEach(cp => cpFailCounts[cp.key] = { name: cp.name, nameEn: cp.nameEn || cp.name, count: 0 });

            sourceRows.forEach(row => {
                let status = 'pass';
                for (let i = 0; i < CHECK_POINTS.length; i++) {
                    const cKey = CHECK_POINTS[i].key;
                    if (row.checks[cKey] === 'fail') {
                        status = 'fail';
                        cpFailCounts[cKey].count++;
                    }
                    if (row.checks[cKey] === 'none' && status !== 'fail') status = 'wait';
                }
                if (status === 'pass') passCount++;
                else if (status === 'fail') failCount++;
                else waitCount++;
            });

            const passRate = total > 0 ? ((passCount / total) * 100).toFixed(1) + '%' : '0%';

            let topFailCp = null;
            let maxFails = -1;
            Object.values(cpFailCounts).forEach(cp => {
                if (cp.count > maxFails) { maxFails = cp.count; topFailCp = cp; }
            });

            let execSummaryZh = `本次审计共抽样 <strong>${total}</strong> 单，其中完全合格 <strong>${passCount}</strong> 单，不合格 <strong>${failCount}</strong> 单（整体合格率 ${passRate}）。`;
            let execSummaryEn = `This audit sampled <strong>${total}</strong> tickets: <strong>${passCount}</strong> fully passed, <strong>${failCount}</strong> failed, with an overall pass rate of ${passRate}.`;
            if (maxFails > 0) {
                const topFailLabel = renderBilingualLabel(topFailCp.name, topFailCp.nameEn, { inline: true });
                execSummaryZh += `主要问题集中在“<strong>${topFailLabel}</strong>”环节，共计 ${maxFails} 次未通过。`;
                execSummaryEn += ` The main issue is concentrated in “<strong>${topFailLabel}</strong>”, with ${maxFails} failed occurrence(s).`;
            } else if (total > 0 && failCount === 0) {
                execSummaryZh += `所有单据表现优秀，未发现任何不合格情况。`;
                execSummaryEn += ` All sampled tickets passed with no failed items found.`;
            }

            let cpTableHtml = '';
            Object.values(cpFailCounts).forEach(cp => {
                let rawRate = total > 0 ? (cp.count / total) * 100 : 0;
                let rate = rawRate.toFixed(1) + '%';
                let barWidth = rawRate > 100 ? 100 : rawRate;
                cpTableHtml += `<tr>
                    <td>${renderBilingualLabel(cp.name, cp.nameEn)}</td>
                    <td>${cp.count}</td>
                    <td>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div style="flex:1; height:6px; background:#e5e5e5; border-radius:3px; overflow:hidden;">
                                <div style="width:${barWidth}%; height:100%; background:#c8102e;"></div>
                            </div>
                            <span style="min-width:35px; text-align:right;">${rate}</span>
                        </div>
                    </td>
                </tr>`;
            });

            const pdfGroups = buildAuditGroups(sourceRows, groupField);
            let tocSeq = 0;
            const tocGroups = pdfGroups.map(group => ({
                value: group.value,
                rows: group.rows.map(row => ({
                    row,
                    label: getRowPrimaryLabel(row),
                    cardId: `audit-card-${++tocSeq}`
                }))
            }));
            const tocHtml = `
                <div class="print-toc-page">
                    <div class="print-toc-title">目录 / Contents</div>
                    ${tocGroups.map(group => `
                        <div class="print-toc-group">${groupField ? `${escapeHtml(groupField)} = ${escapeHtml(group.value)}` : '全部单据 / All Tickets'} （${group.rows.length} 条 / items）</div>
                        ${group.rows.map(item => `
                            <a class="print-toc-item" href="#${item.cardId}" data-toc-target="${item.cardId}">
                                <span>${escapeHtml(primaryField || '单号')}：${escapeHtml(item.label)}</span>
                                <span>↗</span>
                            </a>
                        `).join('')}
                    `).join('')}
                    <div class="print-toc-hint">提示 / Note：批量生成的 PDF 支持点击目录跳转；浏览器打印版是否保留跳转取决于浏览器。</div>
                </div>
            `;

            let filterRulesHtml = '';
            const rules = Array.isArray(activeConfig && activeConfig.filterRules)
                          ? activeConfig.filterRules.filter(r => r && r.field && r.action && r.operator) : [];
            if (rules.length > 0) {
                const actionMapZh = { 'include': '仅保留', 'exclude': '排除' };
                const actionMapEn = { 'include': 'Keep only', 'exclude': 'Exclude' };
                const opMapZh = { 'equals': '等于', 'contains': '包含', 'not_empty': '非空', 'empty': '为空' };
                const opMapEn = { 'equals': 'Equals', 'contains': 'Contains', 'not_empty': 'Not empty', 'empty': 'Empty' };

                const rulesList = rules.map((r, idx) => {
                    let zh = `${idx + 1}. [${escapeHtml(r.field)}] ${actionMapZh[r.action] || r.action} -> ${opMapZh[r.operator] || r.operator}`;
                    let en = `${idx + 1}. [${escapeHtml(r.field)}] ${actionMapEn[r.action] || r.action} -> ${opMapEn[r.operator] || r.operator}`;
                    if (r.operator !== 'empty' && r.operator !== 'not_empty') {
                        zh += `: "${escapeHtml(r.values)}"`;
                        en += `: "${escapeHtml(r.values)}"`;
                    }
                    return `<div style="margin-bottom:4px;">${zh} <span style="color:#888; font-size:11px; margin-left:8px;">(${en})</span></div>`;
                }).join('');

                filterRulesHtml = `
                <div style="margin-top:20px; margin-bottom:20px; padding:15px; background:#fafafa; border:1px solid #e5e5e5; border-radius:4px; font-size:12px; color:#555; line-height:1.6;">
                    <div style="font-weight:600; margin-bottom:8px; color:#191919; font-size:13px;">本次抽样基于以下导入过滤条件 / Applied Import Filters:</div>
                    ${rulesList}
                </div>`;
            }

            let html = `
            <div class="watermark"></div>

            <!-- 封面页 / Cover Page -->
            <div class="print-cover-page">
                <div class="print-cover-title">PR进展自检审计报告</div>
                <div class="print-cover-subtitle">Progress Audit Report</div>
                <div class="print-cover-meta">
                    <div><strong>报告名称：</strong>${escapeHtml(groupValue ? `${title} - ${groupField}: ${groupValue}` : title)}</div>
                    <div><strong>生成时间：</strong>${dateStr}</div>
                    ${groupValue ? `<div><strong>分 组：</strong>${escapeHtml(groupField)} = ${escapeHtml(groupValue)}</div>` : ''}
                    <div><strong>总 抽 样：</strong>${total} 单</div>
                </div>
            </div>

            <!-- 正文页 / Main Content -->
            <div class="print-summary-page">
                <div class="print-title">
                    ${escapeHtml(groupValue ? `${title} - ${groupField}: ${groupValue}` : title)}
                    <span class="print-title-en">Progress Audit Report</span>
                </div>
                <div class="print-meta" style="margin-bottom:40px;">
                    导出时间 / Export Time: ${dateStr}
                    ${groupValue ? `<br>分组 / Group: ${escapeHtml(groupField)} = ${escapeHtml(groupValue)}` : ''}
                </div>

                <h3 style="border-bottom:1px solid #d9d9d9; padding-bottom:10px; margin-bottom:20px; color:#191919;">总体审计情况 / Overall Summary</h3>
                <div class="summary-kpi-container">
                    <div class="summary-kpi-card">
                        <div class="kpi-label">抽样总数 (Total)</div>
                        <div class="summary-kpi-value">${total}</div>
                    </div>
                    <div class="summary-kpi-card">
                        <div class="kpi-label">完全合格 (Pass)</div>
                        <div class="summary-kpi-value" style="color:#00B365;">${passCount}</div>
                    </div>
                    <div class="summary-kpi-card">
                        <div class="kpi-label">不合格 (Fail)</div>
                        <div class="summary-kpi-value" style="color:#c8102e;">${failCount}</div>
                    </div>
                    <div class="summary-kpi-card">
                        <div class="kpi-label">待检查 (Pending)</div>
                        <div class="summary-kpi-value" style="color:#FF9900;">${waitCount}</div>
                    </div>
                </div>

                ${filterRulesHtml}

                <div class="exec-summary-box">
                    <strong>结论总览 / Executive Summary：</strong>
                    <div class="print-summary-zh">${execSummaryZh}</div>
                    <div class="print-summary-en">${execSummaryEn}</div>
                </div>

                <h3 style="border-bottom:1px solid #d9d9d9; padding-bottom:10px; margin-bottom:20px; color:#191919;">各个审计点问题分布 / Checkpoint Issue Distribution</h3>
                <table class="summary-table">
                    <thead>
                        <tr>
                            <th>审计检查点 (Checkpoint)</th>
                            <th width="120">未通过次数 (Fails)</th>
                            <th width="160">问题发生率 (Rate)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${cpTableHtml}
                    </tbody>
                </table>
            </div>
            ${tocHtml}
        `;

            const rf = (activeConfig && activeConfig.reportFields && activeConfig.reportFields.length > 0)
                       ? activeConfig.reportFields
                       : ['标题', '处理人', '任务状态', '是否延期'];

            tocGroups.forEach(group => {
                if (groupField && !groupValue) {
                    html += `<div class="print-group-header">分组 / Group：${escapeHtml(groupField)} = ${escapeHtml(group.value)} （${group.rows.length} 条 / items）</div>`;
                }
                group.rows.forEach((item, idx) => {
                const row = item.row;
                let statusBadge = ''; let status = 'pass';
                for (let i = 0; i < CHECK_POINTS.length; i++) {
                    const cKey = CHECK_POINTS[i].key;
                    if (row.checks[cKey] === 'fail') { status = 'fail'; break; }
                    if (row.checks[cKey] === 'none') status = 'wait';
                }

                if (status === 'pass') statusBadge = '✅ 整体合格 / Overall Pass';
                else if (status === 'fail') statusBadge = '❌ 不合格 / Fail';
                else statusBadge = '⏳ 检查未完成 / Pending';

                let infoGridHtml = '<div class="print-info-grid">';
                let compactCellCount = 0;
                const appendPlaceholderCell = () => {
                    infoGridHtml += `<div class="print-info-item placeholder" aria-hidden="true"></div>`;
                    compactCellCount = 0;
                };

                rf.forEach(f => {
                    const rawValue = row.baseData[f] || '-';
                    infoGridHtml += `
                        <div class="print-info-item">
                            <span class="print-info-label">${renderFieldLabel(f)}</span>
                            <span class="print-info-value">${escapeHtml(rawValue)}</span>
                        </div>
                    `;
                    compactCellCount = (compactCellCount + 1) % 2;
                });
                if (compactCellCount === 1) appendPlaceholderCell();
                infoGridHtml += '</div>';

                html += `
            <div class="print-card" id="${item.cardId}" data-card-id="${item.cardId}">
                <div class="print-card-header">
                    <h3>单号 / Order No.: ${row.id}</h3>
                    <strong class="${status === 'pass' ? 'p-pass' : (status === 'fail' ? 'p-fail' : 'p-wait')}">${statusBadge}</strong>
                </div>
                ${infoGridHtml}
                <table class="print-check-table">
                    <thead>
                        <tr>
                            <th width="30%">审计检查点 / Checkpoint</th>
                            <th width="15%">是否通过 / Result</th>
                            <th width="30%">理由 / Reason</th>
                            <th width="25%">截图证据 / Evidence</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

                CHECK_POINTS.forEach(cp => {
                    const state = row.checks[cp.key]; const reason = row.reasons[cp.key]; const img = row.images[cp.key];

                    let stateText = state === 'pass' ? '<span class="p-pass">✔ 通过 / Pass</span>' : (state === 'fail' ? '<span class="p-fail">✘ 未通过 / Fail</span>' : '<span class="p-wait">待检查 / Pending</span>');
                    let reasonHtml = state === 'fail' && reason ? `<div class="p-reason">不合格事由 / Reason:<br>${reason}</div>` : '';
                    let imgHtml = img ? `<img src="${img}" class="print-img">` : '<span style="color:#aaa;font-size:11px;">(无影像证据 / No Image Evidence)</span>';

                    html += `<tr>
                            <td width="30%">
                                <strong>${cp.name}</strong><br>
                                <span style="font-size:11px; color:#333;">${cp.nameEn}</span><br>
                                <span style="color:#666;font-size:10px;">${cp.desc} / ${cp.descEn}</span>
                            </td>
                            <td width="15%">${stateText}</td>
                            <td width="30%">${reasonHtml}</td>
                            <td width="25%">${imgHtml}</td>
                        </tr>`;
                });
                html += `</tbody></table></div>`;
                });
            });
            if (options.returnHtml) {
                return {
                    html,
                    filename: sanitizeFileName(groupValue ? `${title}_${groupField}_${groupValue}.pdf` : `${title}.pdf`)
                };
            }
            reportDiv.innerHTML = html;
            setTimeout(() => { window.print(); }, 500);
        }

        function sanitizeFileName(name) {
            return String(name || 'report.pdf')
                .replace(/[\\/:*?"<>|]/g, '_')
                .replace(/\s+/g, '_')
                .slice(0, 120);
        }

        function buildSnapshotImportSuffix() {
            const now = new Date();
            const yyyy = now.getFullYear();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            const rand = Math.random().toString(36).slice(2, 6);
            return `${yyyy}${mm}${dd}-${rand}`;
        }

        function ensureUniqueSnapshotImportName(name, existingNames = new Set()) {
            const baseName = String(name || tText('导入快照', 'Imported Snapshot')).trim() || tText('导入快照', 'Imported Snapshot');
            if (!existingNames.has(baseName)) return baseName;
            let candidate = `${baseName}（${buildSnapshotImportSuffix()}）`;
            while (existingNames.has(candidate)) {
                candidate = `${baseName}（${buildSnapshotImportSuffix()}）`;
            }
            return candidate;
        }

        function downloadBlob(blob, filename) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        function getAuditRowStatus(row) {
            let status = 'pass';
            for (let i = 0; i < CHECK_POINTS.length; i++) {
                const cKey = CHECK_POINTS[i].key;
                if (row.checks && row.checks[cKey] === 'fail') return 'fail';
                if (row.checks && row.checks[cKey] === 'none') status = 'wait';
            }
            return status;
        }

        function getAuditStatusLabel(status) {
            const labels = {
                pass: tText('合格', 'Pass'),
                fail: tText('不合格', 'Fail'),
                wait: tText('待检', 'Pending'),
                none: tText('待检', 'Pending')
            };
            return labels[status] || status || '';
        }

        function exportAuditSpreadsheet() {
            try {
                if (!ordersData.length) {
                    showToast(tText('没有可导出的数据！', 'No data to export.'));
                    return;
                }
                if (!window.XLSX) {
                    AppDialog.alert(tText('缺少表格导出依赖 XLSX，请刷新页面后重试。', 'Missing XLSX export dependency. Please refresh and try again.'), { title: tText('导出失败', 'Export failed'), tone: 'error' });
                    return;
                }

                const baseFields = Array.from(new Set([
                    ...((activeConfig && Array.isArray(activeConfig.allFields) && activeConfig.allFields.length) ? activeConfig.allFields : []),
                    ...ALL_FIELDS
                ])).filter(Boolean);
                const exportTime = new Date().toLocaleString('zh-CN', { hour12: false });
                const groupField = getActiveAuditGroupField();
                const rows = ordersData.map((row, index) => {
                    const item = {};
                    item[tText('序号', 'No.')] = index + 1;
                    baseFields.forEach(field => {
                        item[field] = row.baseData && row.baseData[field] !== undefined ? row.baseData[field] : '';
                    });
                    if (groupField) {
                        item[tText('分组', 'Group')] = row.baseData && row.baseData[groupField] ? row.baseData[groupField] : tText('未填写', 'Not filled');
                    }
                    item[tText('整体状态', 'Overall Status')] = getAuditStatusLabel(getAuditRowStatus(row));
                    CHECK_POINTS.forEach(cp => {
                        const cpName = cp.name || cp.key || '-';
                        const cpNameEn = cp.nameEn && cp.nameEn !== cpName ? ` / ${cp.nameEn}` : '';
                        const prefix = `${cpName}${cpNameEn}`;
                        const state = row.checks && row.checks[cp.key] ? row.checks[cp.key] : 'none';
                        item[`${prefix} - ${tText('结果', 'Result')}`] = getAuditStatusLabel(state);
                        item[`${prefix} - ${tText('理由', 'Reason')}`] = row.reasons && row.reasons[cp.key] ? row.reasons[cp.key] : '';
                        item[`${prefix} - ${tText('证据', 'Evidence')}`] = row.images && row.images[cp.key]
                            ? tText('已附截图证据', 'Evidence attached')
                            : tText('未附截图', 'No evidence');
                    });
                    item[tText('导出时间', 'Export Time')] = exportTime;
                    return item;
                });

                const worksheet = XLSX.utils.json_to_sheet(rows);
                const headers = rows.length ? Object.keys(rows[0]) : [];
                worksheet['!cols'] = headers.map(header => ({
                    wch: Math.min(Math.max(String(header).length + 4, 12), 36)
                }));
                const workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, worksheet, tText('PR审计数据', 'PR Audit Data'));
                const arrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
                const title = activeConfig && activeConfig.name ? activeConfig.name : tText('PR审计报告', 'PR Audit Report');
                const filename = sanitizeFileName(`${title}_${tText('审计明细', 'Audit_Details')}_${new Date().toISOString().slice(0, 10)}.xlsx`);
                downloadBlob(new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
                showToast(tText(`已导出 ${rows.length} 条审计明细`, `Exported ${rows.length} audit rows`));
            } catch (err) {
                console.error('导出表格失败', err);
                AppDialog.alert(`${tText('导出表格失败', 'Spreadsheet export failed')}：${err.message}`, { title: tText('导出失败', 'Export failed'), tone: 'error' });
            }
        }

        const PRAUDIT_OFFLINE_ASSET_PATHS = [
            '/css/shared.css',
            '/js/shared/xlsx.full.min.js',
            '/js/shared/localforage.min.js',
            '/js/shared/html2canvas.min.js',
            '/js/shared/jspdf.umd.min.js',
            '/js/shared/jszip.min.js',
            '/js/shared/praudit-offline-runtime.js',
            '/css/pages/praudit.css',
            '/js/pages/praudit/main.js'
        ];

        let cachedOfflineWorkbenchHtmlTemplate = '';
        let cachedOfflineRuntimeJs = '';

        function escapeInlineScriptContent(text) {
            return String(text || '').replace(/<\/script/gi, '<\\/script');
        }

        function wrapInlineScript(code) {
            return `<script>\n${escapeInlineScriptContent(code)}\n</scr` + 'ipt>';
        }

        async function fetchTextAsset(path) {
            const res = await fetch(path, { cache: 'no-store' });
            if (!res.ok) throw new Error(`无法读取离线资源：${path}`);
            return res.text();
        }

        function buildOfflineHtmlFromCurrentDocument() {
            let html = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
            html = html.replace(/<title>.*?<\/title>/i, '<title>PR审计报告系统（离线版）</title>');
            html = html.replace(/<nav id="app-navbar"[\s\S]*?<\/nav>/i, '');
            html = html.replace(/<div id="globalToast"[\s\S]*?<\/div>/i, '');
            html = html.replace(/<div id="dataSourceBadge"[\s\S]*?<\/div>/i, '');
            html = html.replace(/<div id="offlineModeBadge"[\s\S]*?<\/div>/i, '');
            html = html.replace(/<div id="prauditOfflineGuide"[\s\S]*?<\/div>/i, '');
            html = html.replace(/<div id="user-mgmt-modal"[\s\S]*?<\/div>/i, '');
            html = html.replace(/<div id="floatingTableHeader" class="floating-table-header" aria-hidden="true">[\s\S]*?<\/div>/i, '<div id="floatingTableHeader" class="floating-table-header" aria-hidden="true"></div>');
            return html;
        }

        async function buildOfflineWorkbenchHtml(workspaceId = '') {
            if (window.__PRAUDIT_OFFLINE__) {
                return buildOfflineHtmlFromCurrentDocument();
            }
            if (!cachedOfflineWorkbenchHtmlTemplate) {
                const [rawHtml, sharedCss, xlsxJs, localforageJs, html2canvasJs, jspdfJs, jszipJs, offlineRuntimeJs, prauditCss, prauditJs] = await Promise.all([
                    fetchTextAsset(window.location.pathname),
                    fetchTextAsset(PRAUDIT_OFFLINE_ASSET_PATHS[0]),
                    fetchTextAsset(PRAUDIT_OFFLINE_ASSET_PATHS[1]),
                    fetchTextAsset(PRAUDIT_OFFLINE_ASSET_PATHS[2]),
                    fetchTextAsset(PRAUDIT_OFFLINE_ASSET_PATHS[3]),
                    fetchTextAsset(PRAUDIT_OFFLINE_ASSET_PATHS[4]),
                    fetchTextAsset(PRAUDIT_OFFLINE_ASSET_PATHS[5]),
                    fetchTextAsset(PRAUDIT_OFFLINE_ASSET_PATHS[6]),
                    fetchTextAsset(PRAUDIT_OFFLINE_ASSET_PATHS[7]),
                    fetchTextAsset(PRAUDIT_OFFLINE_ASSET_PATHS[8])
                ]);

                let html = rawHtml;
                html = html.replace(/<title>.*?<\/title>/i, () => '<title>PR审计报告系统（离线版）</title>');
                html = html.replace(/<link rel="stylesheet" href="\/css\/shared\.css(?:\?[^"]*)?">/i, () => `<style>\n${sharedCss}\n</style>`);
                html = html.replace(/<link rel="stylesheet" href="\/css\/pages\/praudit\.css(?:\?[^"]*)?">/i, () => `<style>\n${prauditCss}\n</style>`);
                html = html.replace(/<script src="\/js\/shared\/xlsx\.full\.min\.js(?:\?[^"]*)?"><\/script>/i, () => wrapInlineScript(xlsxJs));
                html = html.replace(/<script src="\/js\/shared\/localforage\.min\.js(?:\?[^"]*)?"><\/script>/i, () => wrapInlineScript(localforageJs));
                html = html.replace(/<script src="\/js\/shared\/html2canvas\.min\.js(?:\?[^"]*)?"><\/script>/i, () => wrapInlineScript(html2canvasJs));
                html = html.replace(/<script src="\/js\/shared\/jspdf\.umd\.min\.js(?:\?[^"]*)?"><\/script>/i, () => wrapInlineScript(jspdfJs));
                html = html.replace(/<script src="\/js\/shared\/jszip\.min\.js(?:\?[^"]*)?"><\/script>/i, () => wrapInlineScript(jszipJs));
                html = html.replace(/\s*<script src="\/js\/shared\/api\.js(?:\?[^"]*)?"><\/script>/i, () => '');
                html = html.replace(/\s*<script src="\/js\/shared\/toast\.js(?:\?[^"]*)?"><\/script>/i, () => '');
                html = html.replace(/\s*<script src="\/js\/shared\/navbar\.js(?:\?[^"]*)?"><\/script>/i, () => '');
                html = html.replace(/<script src="\/js\/pages\/praudit\/main\.js(?:\?[^"]*)?"><\/script>/i, () => `${wrapInlineScript('__PRAUDIT_OFFLINE_BOOTSTRAP__')}\n${wrapInlineScript(prauditJs)}`);
                cachedOfflineWorkbenchHtmlTemplate = html;
            }
            if (!cachedOfflineRuntimeJs) {
                cachedOfflineRuntimeJs = await fetchTextAsset(PRAUDIT_OFFLINE_ASSET_PATHS[6]);
            }
            const bootstrapScript = `window.__PRAUDIT_OFFLINE__ = true;\nwindow.__PRAUDIT_OFFLINE_WORKSPACE_ID__ = ${JSON.stringify(String(workspaceId || 'default'))};\n${cachedOfflineRuntimeJs}`;
            return cachedOfflineWorkbenchHtmlTemplate.replace('__PRAUDIT_OFFLINE_BOOTSTRAP__', escapeInlineScriptContent(bootstrapScript));
        }

        async function appendOfflineAuditWorkbenchFiles(zip, snapshotBlob, snapshotFilename, options = {}) {
            const folderPrefix = options.folderPrefix || '';
            const workspaceId = options.workspaceId || createSnapshotBundleId();
            const offlineHtml = await buildOfflineWorkbenchHtml(workspaceId);
            const htmlName = options.htmlName || 'PR审计报告系统.html';
            const readmeName = options.readmeName || 'README.txt';
            const readmeLines = [
                'PR Audit Offline Workspace',
                '',
                '1. Open "PR审计报告系统.html".',
                '2. Import the snapshot zip/json in the same folder.',
                '3. Continue the audit offline and export a new snapshot package after finishing.',
                '',
                '1. 双击打开 “PR审计报告系统.html”。',
                '2. 导入同目录中的快照 zip/json。',
                '3. 审计完成后再导出新的快照包回传即可。'
            ];
            zip.file(`${folderPrefix}${htmlName}`, offlineHtml);
            zip.file(`${folderPrefix}${snapshotFilename}`, snapshotBlob);
            zip.file(`${folderPrefix}${readmeName}`, readmeLines.join('\n'));
        }

        function createSnapshotBundleId() {
            return `praudit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        }

        function getShortBundleToken(bundleId) {
            return String(bundleId || '').replace(/^praudit_/, '').slice(0, 12);
        }

        function extractOfflinePackageToken(name) {
            const matches = Array.from(String(name || '').matchAll(/（离线包-([^)）]+)）/g));
            return matches.length ? matches[0][1] : '';
        }

        function makeOfflineTemplateLabel(baseName, bundleId, options = {}) {
            const shortBundle = getShortBundleToken(bundleId) || Math.random().toString(36).slice(2, 8);
            const groupLabel = options.groupValue ? `-${String(options.groupValue)}` : '';
            return `${String(baseName || 'PR Audit')}${groupLabel}（离线包-${shortBundle}）`;
        }

        function makeOfflineTemplateId(bundleId, options = {}) {
            const shortBundle = String(bundleId || '').replace(/^praudit_/, '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16) || Math.random().toString(36).slice(2, 10);
            const groupPart = options.groupIndex ? `_g${options.groupIndex}` : '';
            return `offlinepkg_${shortBundle}${groupPart}`;
        }

        function getSnapshotTemplate(snapshot) {
            return snapshot && (snapshot.template || snapshot.config) ? (snapshot.template || snapshot.config) : {};
        }

        function buildSnapshotWorkspace(options = {}, templateConfig = activeConfig) {
            const baseWorkspace = activeWorkspace ? JSON.parse(JSON.stringify(activeWorkspace)) : getAuditWorkspaceForConfig(templateConfig);
            return {
                ...baseWorkspace,
                id: options.workspaceId || baseWorkspace.id || createAuditWorkspaceId('snapshot_ws'),
                name: options.workspaceName || baseWorkspace.name || `${templateConfig && templateConfig.name ? templateConfig.name : 'PR Audit'} 工作区`,
                templateId: templateConfig && templateConfig.id ? templateConfig.id : baseWorkspace.templateId || '',
                templateName: options.templateName || (templateConfig && templateConfig.name ? templateConfig.name : baseWorkspace.templateName || ''),
                batchId: options.bundleId || baseWorkspace.batchId || '',
                mergeKey: options.mergeKey || baseWorkspace.mergeKey || '',
                scope: options.scope || baseWorkspace.scope || 'all',
                groupField: options.groupField || baseWorkspace.groupField || '',
                groupValue: options.groupValue || baseWorkspace.groupValue || '',
                groupIndex: options.groupIndex || baseWorkspace.groupIndex || 0,
                groupCount: options.groupCount || baseWorkspace.groupCount || 0,
                exportedAt: new Date().toISOString()
            };
        }

        function buildAuditSnapshot(rows = ordersData, options = {}) {
            if (!activeConfig) throw new Error('当前没有可导出的审计模板。');
            const now = new Date().toISOString();
            const snapshotConfig = JSON.parse(JSON.stringify(activeConfig));
            if (options.templateName) {
                snapshotConfig.name = options.templateName;
            }
            if (options.templateId) {
                snapshotConfig.id = options.templateId;
            }
            const snapshotWorkspace = buildSnapshotWorkspace(options, snapshotConfig);
            return {
                version: 2,
                type: 'praudit-work-snapshot',
                exportedAt: now,
                scope: options.scope || 'all',
                groupField: options.groupField || '',
                groupValue: options.groupValue || '',
                sourceConfigId: activeConfig.id,
                template: snapshotConfig,
                workspace: snapshotWorkspace,
                config: snapshotConfig,
                rows: JSON.parse(JSON.stringify(rows || [])),
                visibleCols: JSON.parse(JSON.stringify(visibleCols || [])),
                meta: {
                    app: 'tools-platform',
                    page: 'praudit',
                    rowCount: (rows || []).length,
                    templateName: options.templateName || activeConfig.name,
                    language: currentLang,
                    bundleId: options.bundleId || '',
                    mergeKey: options.mergeKey || '',
                    bundleType: options.bundleType || '',
                    groupIndex: options.groupIndex || 0,
                    groupCount: options.groupCount || 0,
                    workspaceId: snapshotWorkspace.id,
                    workspaceName: snapshotWorkspace.name
                }
            };
        }

        async function makeSnapshotZipBlob(snapshot) {
            if (!window.JSZip) throw new Error('缺少压缩依赖 JSZip，请检查网络后重试。');
            const zip = new JSZip();
            const template = getSnapshotTemplate(snapshot);
            zip.file('snapshot.json', JSON.stringify(snapshot, null, 2));
            zip.file('README.txt', [
                'PR Audit Work Snapshot',
                `Template: ${template && template.name ? template.name : '-'}`,
                `Workspace: ${snapshot.workspace && snapshot.workspace.name ? snapshot.workspace.name : '-'}`,
                `Rows: ${snapshot.rows ? snapshot.rows.length : 0}`,
                `Scope: ${snapshot.scope || 'all'}`,
                snapshot.groupField ? `Group: ${snapshot.groupField} = ${snapshot.groupValue}` : '',
                '',
                'Import this zip from PR Audit page -> 导入快照.'
            ].filter(Boolean).join('\n'));
            return zip.generateAsync({ type: 'blob' });
        }

        async function exportAuditSnapshot() {
            try {
                if (!ordersData.length) {
                    showToast('当前没有可导出的表格数据。');
                    return;
                }
                const bundleId = createSnapshotBundleId();
                const mergeKey = extractOfflinePackageToken(activeConfig.name) || getShortBundleToken(bundleId);
                const offlineTemplateName = makeOfflineTemplateLabel(activeConfig.name, bundleId);
                const offlineTemplateId = makeOfflineTemplateId(bundleId);
                const snapshot = buildAuditSnapshot(ordersData, {
                    scope: 'all',
                    bundleId,
                    mergeKey,
                    bundleType: 'single',
                    groupIndex: 1,
                    groupCount: 1,
                    templateName: offlineTemplateName,
                    templateId: offlineTemplateId
                });
                const snapshotBlob = await makeSnapshotZipBlob(snapshot);
                const packageZip = new JSZip();
                const snapshotFilename = sanitizeFileName(`${offlineTemplateName}_PR审计快照_${snapshot.rows.length}条.zip`);
                await appendOfflineAuditWorkbenchFiles(packageZip, snapshotBlob, snapshotFilename, {
                    workspaceId: `single_${bundleId}`
                });
                packageZip.file('manifest.json', JSON.stringify({
                    version: 1,
                    type: 'praudit-offline-workspace',
                    exportedAt: new Date().toISOString(),
                    bundleId,
                    templateName: offlineTemplateName,
                    rowCount: snapshot.rows.length,
                    snapshotFile: snapshotFilename
                }, null, 2));
                const finalBlob = await packageZip.generateAsync({ type: 'blob' });
                downloadBlob(finalBlob, sanitizeFileName(`${offlineTemplateName}_离线审计工作包_${snapshot.rows.length}条.zip`));
            } catch (err) {
                console.error('导出快照失败', err);
                AppDialog.alert(`导出快照失败：${err.message}`, { title: '导出失败', tone: 'error' });
            }
        }

        async function exportAuditSnapshotByGroup(btn = null) {
            try {
                if (!ordersData.length) {
                    showToast('当前没有可导出的表格数据。');
                    return;
                }
                const groupField = getActiveAuditGroupField();
                if (!groupField) {
                    AppDialog.alert('当前审计模板未设置有效的分组字段，无法按分组导出快照。', { title: '无法导出', tone: 'warning' });
                    return;
                }
                if (!window.JSZip) {
                    AppDialog.alert('缺少压缩依赖 JSZip，请检查网络后重试。', { title: '导出失败', tone: 'error' });
                    return;
                }
                const groups = buildAuditGroups(ordersData, groupField).filter(group => group.rows.length > 0);
                const bundleId = createSnapshotBundleId();
                const mergeKey = extractOfflinePackageToken(activeConfig.name) || getShortBundleToken(bundleId);
                const outerZip = new JSZip();
                const originalText = btn ? btn.innerText : '';
                if (btn) {
                    btn.disabled = true;
                    btn.innerText = tText('正在生成分组快照...', 'Generating group snapshots...');
                }
                for (let i = 0; i < groups.length; i++) {
                    const group = groups[i];
                    if (btn) btn.innerText = tText(`生成快照 ${i + 1}/${groups.length}`, `Generating snapshot ${i + 1}/${groups.length}`);
                    const offlineTemplateName = makeOfflineTemplateLabel(activeConfig.name, bundleId, { groupValue: group.value });
                    const offlineTemplateId = makeOfflineTemplateId(bundleId, { groupIndex: i + 1 });
                    const snapshot = buildAuditSnapshot(group.rows, {
                        scope: 'group',
                        groupField,
                        groupValue: group.value,
                        bundleId,
                        mergeKey,
                        bundleType: 'group',
                        groupIndex: i + 1,
                        groupCount: groups.length,
                        templateName: offlineTemplateName,
                        templateId: offlineTemplateId
                    });
                    const snapshotBlob = await makeSnapshotZipBlob(snapshot);
                    const folderName = sanitizeFileName(`${String(i + 1).padStart(2, '0')}_${group.value}`);
                    const snapshotFilename = sanitizeFileName(`${offlineTemplateName}_${group.rows.length}条_PR审计快照.zip`);
                    await appendOfflineAuditWorkbenchFiles(outerZip, snapshotBlob, snapshotFilename, {
                        folderPrefix: `${folderName}/`,
                        workspaceId: `group_${bundleId}_${i + 1}`
                    });
                }
                outerZip.file('manifest.json', JSON.stringify({
                    version: 1,
                    type: 'praudit-group-snapshot-bundle',
                    exportedAt: new Date().toISOString(),
                    bundleId,
                    templateName: makeOfflineTemplateLabel(activeConfig.name, bundleId),
                    groupField,
                    groups: groups.map(group => ({ groupValue: group.value, rowCount: group.rows.length }))
                }, null, 2));
                outerZip.file('README.txt', [
                    'PR Audit Group Snapshot Bundle',
                    `Template: ${activeConfig.name}`,
                    `Group Field: ${groupField}`,
                    `Groups: ${groups.length}`,
                    '',
                    'Each group folder includes a standalone offline HTML workspace and its own snapshot zip.',
                    'Send the corresponding group folder to the group owner.',
                    'The receiver opens the HTML file and imports the snapshot zip in the same folder.',
                    '',
                    '每个分组文件夹都包含一份独立离线 HTML 工作台和对应快照 zip，可直接发给责任人继续处理。'
                ].join('\n'));
                if (btn) btn.innerText = tText('正在压缩下载...', 'Compressing download...');
                const finalBlob = await outerZip.generateAsync({ type: 'blob' });
                downloadBlob(finalBlob, sanitizeFileName(`${activeConfig.name}_${groupField}_分组离线审计包.zip`));
                if (btn) {
                    btn.disabled = false;
                    restoreI18nButtonLabel(btn, '🧩 按分组导出快照', '🧩 Export Group Snapshots');
                }
            } catch (err) {
                console.error('按分组导出快照失败', err);
                AppDialog.alert(`按分组导出快照失败：${err.message}`, { title: '导出失败', tone: 'error' });
                if (btn) {
                    btn.disabled = false;
                    restoreI18nButtonLabel(btn, '🧩 按分组导出快照', '🧩 Export Group Snapshots');
                }
            }
        }

        async function readSnapshotFromFile(file) {
            if (!file) throw new Error('未选择快照文件。');
            if (file.name.toLowerCase().endsWith('.json')) {
                return JSON.parse(await file.text());
            }
            if (!window.JSZip) throw new Error('缺少压缩依赖 JSZip，请检查网络后重试。');
            const zip = await JSZip.loadAsync(file);
            const snapshotFile = zip.file('snapshot.json');
            if (snapshotFile) {
                return JSON.parse(await snapshotFile.async('string'));
            }

            const nestedSnapshotZips = Object.keys(zip.files).filter(name => name.toLowerCase().endsWith('.zip'));
            if (nestedSnapshotZips.length === 1) {
                const nestedZipBlob = await zip.file(nestedSnapshotZips[0]).async('blob');
                const nestedZip = await JSZip.loadAsync(nestedZipBlob);
                const nestedSnapshotFile = nestedZip.file('snapshot.json');
                if (nestedSnapshotFile) {
                    return JSON.parse(await nestedSnapshotFile.async('string'));
                }
            }
            if (nestedSnapshotZips.length) {
                if (nestedSnapshotZips.length > 1) {
                    throw new Error('这是分组快照总包，请先解压后选择其中某个分组文件夹内的快照 zip 导入。');
                }
                throw new Error('当前压缩包内未找到可识别的 snapshot.json。');
            }
            if (!snapshotFile) {
                throw new Error('压缩包中未找到 snapshot.json。');
            }
        }

        function getSnapshotBundleId(snapshot) {
            if (snapshot && snapshot.meta && snapshot.meta.bundleId) return String(snapshot.meta.bundleId);
            if (snapshot && snapshot.workspace && snapshot.workspace.batchId) return String(snapshot.workspace.batchId);
            return '';
        }

        function getSnapshotMergeKey(snapshot) {
            const metaKey = snapshot && snapshot.meta && snapshot.meta.mergeKey ? String(snapshot.meta.mergeKey) : '';
            if (metaKey) return metaKey;
            const workspaceKey = snapshot && snapshot.workspace && snapshot.workspace.mergeKey ? String(snapshot.workspace.mergeKey) : '';
            if (workspaceKey) return workspaceKey;
            const template = getSnapshotTemplate(snapshot);
            const nameKey = template ? extractOfflinePackageToken(template.name) : '';
            if (nameKey) return nameKey;
            return getSnapshotBundleId(snapshot);
        }

        function getSnapshotConfigSignature(snapshot) {
            const config = getSnapshotTemplate(snapshot);
            return JSON.stringify({
                fields: config.fields || [],
                checkpoints: config.checkpoints || [],
                reportFields: config.reportFields || [],
                groupField: config.groupField || ''
            });
        }

        function mergeSnapshotRows(snapshots) {
            const mergedRows = [];
            const rowMap = new Map();
            let overwriteCount = 0;
            snapshots.forEach(snapshot => {
                (snapshot.rows || []).forEach(row => {
                    const rowId = row && row.id ? String(row.id) : `row_${mergedRows.length}`;
                    const clonedRow = JSON.parse(JSON.stringify(row));
                    if (rowMap.has(rowId)) {
                        const index = rowMap.get(rowId);
                        mergedRows[index] = clonedRow;
                        overwriteCount++;
                    } else {
                        rowMap.set(rowId, mergedRows.length);
                        mergedRows.push(clonedRow);
                    }
                });
            });
            return { rows: mergedRows, overwriteCount };
        }

        async function importSingleSnapshotObject(snapshot, options = {}) {
            validateAuditSnapshot(snapshot);
            const config = JSON.parse(JSON.stringify(getSnapshotTemplate(snapshot)));
            const snapshotWorkspace = snapshot.workspace && snapshot.workspace.id
                ? JSON.parse(JSON.stringify(snapshot.workspace))
                : {
                    id: createAuditWorkspaceId('import_ws'),
                    name: config.name || 'Imported Snapshot Workspace',
                    templateId: snapshot.sourceConfigId || config.id || '',
                    templateName: config.name || '',
                    batchId: getSnapshotBundleId(snapshot),
                    mergeKey: getSnapshotMergeKey(snapshot),
                    scope: snapshot.scope || 'all',
                    groupField: snapshot.groupField || '',
                    groupValue: snapshot.groupValue || '',
                    groupIndex: snapshot.meta && snapshot.meta.groupIndex ? snapshot.meta.groupIndex : 0,
                    groupCount: snapshot.meta && snapshot.meta.groupCount ? snapshot.meta.groupCount : 0
                };
            const existingNames = options.existingNames || new Set(ALL_CONFIGS.map(c => String(c.name || '').trim()).filter(Boolean));
            const originalName = config.name;
            config.id = `snapshot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
            const mergedSuffix = options.mergedLabel
                ? `${originalName || config.name}${options.mergedLabel}`
                : (config.name || `${originalName}（导入快照）`);
            config.name = ensureUniqueSnapshotImportName(mergedSuffix, existingNames);
            existingNames.add(config.name);
            snapshotWorkspace.id = options.workspaceId || createAuditWorkspaceId(options.mergedLabel ? 'merged_ws' : 'import_ws');
            snapshotWorkspace.name = options.workspaceName || config.name;
            snapshotWorkspace.templateId = config.id;
            snapshotWorkspace.templateName = config.name;
            snapshotWorkspace.importedAt = new Date().toISOString();
            const savedConfig = await API.post('/api/praudit/configs', {
                id: config.id,
                name: config.name,
                fields: config.fields,
                allFields: config.allFields || config.fields,
                checkpoints: config.checkpoints,
                reportFields: config.reportFields || [],
                groupField: config.groupField || '',
                filterRules: config.filterRules || [],
                reasonTemplates: config.reasonTemplates || []
            });
            saveAuditWorkspaceForConfig(savedConfig.id, snapshotWorkspace);

            const dataKey = getWorkspaceDataKey(snapshotWorkspace.id);
            const colsKey = getWorkspaceColsKey(snapshotWorkspace.id);
            const clonedRows = JSON.parse(JSON.stringify(snapshot.rows));
            if (window.__PRAUDIT_OFFLINE__) {
                try {
                    localStorage.setItem(dataKey, JSON.stringify(clonedRows));
                } catch (e) {
                    console.warn("离线导入 localStorage 镜像写入失败:", e);
                }
            }
            await localforage.setItem(dataKey, clonedRows);
            if (Array.isArray(snapshot.visibleCols) && snapshot.visibleCols.length) {
                localStorage.setItem(colsKey, JSON.stringify(snapshot.visibleCols.filter(col => config.fields.includes(col))));
            }
            return {
                config: savedConfig,
                workspace: snapshotWorkspace,
                snapshot: JSON.parse(JSON.stringify(snapshot))
            };
        }

        function buildMergedSnapshotImport(snapshotGroup) {
            const baseSnapshot = JSON.parse(JSON.stringify(snapshotGroup[0]));
            const { rows, overwriteCount } = mergeSnapshotRows(snapshotGroup);
            baseSnapshot.rows = rows;
            baseSnapshot.scope = 'merged-import';
            baseSnapshot.groupField = '';
            baseSnapshot.groupValue = '';
            baseSnapshot.workspace = {
                ...(baseSnapshot.workspace || {}),
                id: createAuditWorkspaceId('merged_ws'),
                name: baseSnapshot.workspace && baseSnapshot.workspace.name ? baseSnapshot.workspace.name : 'Merged PR Audit Workspace',
                scope: 'merged-import',
                groupField: '',
                groupValue: '',
                groupIndex: 0,
                groupCount: snapshotGroup.length,
                mergedAt: new Date().toISOString()
            };
            baseSnapshot.meta = {
                ...(baseSnapshot.meta || {}),
                importedMerged: true,
                importedFileCount: snapshotGroup.length,
                importedOverwriteCount: overwriteCount
            };
            return { snapshot: baseSnapshot, overwriteCount };
        }

        function validateAuditSnapshot(snapshot) {
            if (!snapshot || snapshot.type !== 'praudit-work-snapshot') {
                throw new Error('快照类型不正确。');
            }
            const template = getSnapshotTemplate(snapshot);
            if (!template || !template.name || !Array.isArray(template.fields) || !Array.isArray(template.checkpoints)) {
                throw new Error('快照模板配置不完整。');
            }
            if (!Array.isArray(snapshot.rows)) {
                throw new Error('快照表格数据不完整。');
            }
        }

        async function importAuditSnapshot(input) {
            const files = input && input.files ? Array.from(input.files) : [];
            try {
                if (!files.length) return;
                const parsedSnapshots = [];
                for (const file of files) {
                    const snapshot = await readSnapshotFromFile(file);
                    validateAuditSnapshot(snapshot);
                    parsedSnapshots.push({
                        fileName: file.name,
                        snapshot
                    });
                }

                const groupedByBundle = new Map();
                parsedSnapshots.forEach(item => {
                    const bundleId = getSnapshotMergeKey(item.snapshot);
                    const signature = getSnapshotConfigSignature(item.snapshot);
                    const groupKey = bundleId ? `bundle:${bundleId}::${signature}` : `single:${item.fileName}:${signature}`;
                    if (!groupedByBundle.has(groupKey)) groupedByBundle.set(groupKey, []);
                    groupedByBundle.get(groupKey).push(item.snapshot);
                });

                const importedConfigs = [];
                const existingImportNames = new Set(ALL_CONFIGS.map(c => String(c.name || '').trim()).filter(Boolean));
                let mergedGroupCount = 0;
                let mergedRowCount = 0;
                for (const snapshotGroup of groupedByBundle.values()) {
                    if (snapshotGroup.length > 1 && getSnapshotBundleId(snapshotGroup[0])) {
                        const { snapshot: mergedSnapshot } = buildMergedSnapshotImport(snapshotGroup);
                        const mergedLabel = tText(`（合并导入 ${snapshotGroup.length} 份）`, ` (Merged ${snapshotGroup.length} files)`);
                        const imported = await importSingleSnapshotObject(mergedSnapshot, { mergedLabel, existingNames: existingImportNames });
                        importedConfigs.push({
                            config: imported.config,
                            snapshot: imported.snapshot,
                            rowCount: mergedSnapshot.rows.length,
                            merged: true,
                            fileCount: snapshotGroup.length
                        });
                        mergedGroupCount++;
                        mergedRowCount += mergedSnapshot.rows.length;
                    } else {
                        const imported = await importSingleSnapshotObject(snapshotGroup[0], { existingNames: existingImportNames });
                        importedConfigs.push({
                            config: imported.config,
                            snapshot: imported.snapshot,
                            rowCount: (snapshotGroup[0].rows || []).length,
                            merged: false,
                            fileCount: 1
                        });
                    }
                }

                const lastImported = importedConfigs[importedConfigs.length - 1];
                const savedConfig = lastImported.config;
                localStorage.setItem('PR_Auditor_LastConfigId', savedConfig.id);
                await loadConfigs();
                document.getElementById('auditTypeSelector').value = savedConfig.id;
                await switchAuditType();
                if (lastImported.snapshot && activeConfig && activeConfig.id === savedConfig.id) {
                    const importedRows = Array.isArray(lastImported.snapshot.rows)
                        ? JSON.parse(JSON.stringify(lastImported.snapshot.rows))
                        : [];
                    if ((!ordersData || ordersData.length === 0) && importedRows.length > 0) {
                        ordersData = importedRows;
                        ordersData.forEach(row => {
                            if (!row.reasons) row.reasons = {};
                            if (!row.checks) row.checks = {};
                            if (!row.images) row.images = {};
                            CHECK_POINTS.forEach(cp => {
                                if (!row.reasons[cp.key]) row.reasons[cp.key] = '';
                                if (!row.checks[cp.key]) row.checks[cp.key] = 'none';
                                if (!row.images[cp.key]) row.images[cp.key] = '';
                            });
                        });
                        if (Array.isArray(lastImported.snapshot.visibleCols) && lastImported.snapshot.visibleCols.length) {
                            visibleCols = lastImported.snapshot.visibleCols.filter(col => ALL_FIELDS.includes(col));
                        }
                        if (!visibleCols.length && ALL_FIELDS.length) {
                            visibleCols = ALL_FIELDS.slice(0, Math.min(4, ALL_FIELDS.length));
                        }
                        renderTable();
                        initColConfig();
                    }
                }
                if (importedConfigs.length === 1 && !importedConfigs[0].merged) {
                    showToast(tText(`快照导入成功：${savedConfig.name}（${importedConfigs[0].rowCount} 条）`, `Snapshot imported: ${savedConfig.name} (${importedConfigs[0].rowCount} rows)`));
                } else {
                    showToast(tText(
                        `已导入 ${importedConfigs.length} 组快照，其中合并 ${mergedGroupCount} 组，共 ${mergedRowCount} 条合并数据`,
                        `Imported ${importedConfigs.length} snapshot sets, merged ${mergedGroupCount} set(s), ${mergedRowCount} merged rows`
                    ));
                }
            } catch (err) {
                console.error('导入快照失败', err);
                AppDialog.alert(`导入快照失败：${err.message}`, { title: '导入失败', tone: 'error' });
            } finally {
                if (input) input.value = '';
            }
        }

        async function generatePdfBlobFromHtml(html) {
            if (!window.html2canvas || !window.jspdf || !window.jspdf.jsPDF) {
                throw new Error('缺少 PDF 生成依赖，请检查网络是否能加载 html2canvas / jsPDF。');
            }
            const renderRoot = document.createElement('div');
            renderRoot.className = 'pdf-render-root';
            renderRoot.innerHTML = html;
            document.body.appendChild(renderRoot);
            await new Promise(resolve => setTimeout(resolve, 80));

            try {
                const { jsPDF } = window.jspdf;
                const pdf = new jsPDF('p', 'mm', 'a4');
                const pageWidth = pdf.internal.pageSize.getWidth();
                const pageHeight = pdf.internal.pageSize.getHeight();
                const margin = 8;
                const gap = 5;
                const contentWidth = pageWidth - margin * 2;
                const contentHeight = pageHeight - margin * 2;
                let cursorY = margin;
                let hasContentOnPage = false;
                const cardPageMap = new Map();
                const pendingTocLinks = [];

                const renderBlock = async (el) => {
                    const wm = document.createElement('div');
                    wm.className = 'watermark';
                    wm.style.position = 'absolute';
                    wm.style.top = '0';
                    wm.style.left = '0';
                    wm.style.width = '100%';
                    wm.style.height = '100%';
                    wm.style.zIndex = '9999';
                    const originalPosition = el.style.position;
                    if (!originalPosition || originalPosition === 'static') {
                        el.style.position = 'relative';
                    }
                    el.appendChild(wm);

                    const elementRect = el.getBoundingClientRect();

                    const canvas = await html2canvas(el, {
                        scale: 2,
                        useCORS: true,
                        allowTaint: true,
                        backgroundColor: '#ffffff',
                        logging: false
                    });
                    if (wm && wm.parentNode === el) el.removeChild(wm);
                    el.style.position = originalPosition;

                    const baseWidth = contentWidth;

                    const baseHeight = canvas.height * baseWidth / canvas.width;
                    const forceSinglePage = el.classList.contains('print-card') || el.classList.contains('print-toc-page');
                    const scale = forceSinglePage && baseHeight > contentHeight
                        ? contentHeight / baseHeight
                        : 1;
                    const pdfWidth = baseWidth * scale;
                    const pdfHeight = baseHeight * scale;
                    const cssToPdfRatio = elementRect.width ? pdfWidth / elementRect.width : 1;
                    const tocLinks = Array.from(el.querySelectorAll('.print-toc-item[data-toc-target]')).map(linkEl => {
                        const rect = linkEl.getBoundingClientRect();
                        return {
                            target: linkEl.getAttribute('data-toc-target'),
                            x: (rect.left - elementRect.left) * cssToPdfRatio,
                            y: (rect.top - elementRect.top) * cssToPdfRatio,
                            w: rect.width * cssToPdfRatio,
                            h: rect.height * cssToPdfRatio
                        };
                    });
                    return {
                        data: canvas.toDataURL('image/jpeg', 0.92),
                        width: pdfWidth,
                        height: pdfHeight,
                        isCover: el.classList.contains('print-cover-page'),
                        isSummary: el.classList.contains('print-summary-page'),
                        isToc: el.classList.contains('print-toc-page'),
                        isGroupHeader: el.classList.contains('print-group-header'),
                        isCard: el.classList.contains('print-card'),
                        cardId: el.getAttribute('data-card-id') || '',
                        tocLinks
                    };
                };

                const addNewPage = () => {
                    pdf.addPage();
                    cursorY = margin;
                    hasContentOnPage = false;
                };

                const blocks = Array.from(renderRoot.children)
                    .filter(el => el.classList.contains('print-cover-page') || el.classList.contains('print-summary-page') || el.classList.contains('print-toc-page') || el.classList.contains('print-group-header') || el.classList.contains('print-card'));

                for (let i = 0; i < blocks.length; i++) {
                    const block = await renderBlock(blocks[i]);

                    if (block.isCover && hasContentOnPage) addNewPage();
                    if (block.isSummary && hasContentOnPage) addNewPage();
                    if (block.isToc && hasContentOnPage) addNewPage();
                    if (block.isGroupHeader && hasContentOnPage && (pageHeight - margin - cursorY) < 90) {
                        addNewPage();
                    }
                    if (!block.isSummary && hasContentOnPage && cursorY + block.height > pageHeight - margin) {
                        addNewPage();
                    }

                    const x = margin + (contentWidth - block.width) / 2;
                    const currentPage = pdf.getNumberOfPages();
                    pdf.addImage(block.data, 'JPEG', x, cursorY, block.width, block.height);
                    if (block.isCard && block.cardId) {
                        cardPageMap.set(block.cardId, currentPage);
                    }
                    if (block.isToc && block.tocLinks.length) {
                        block.tocLinks.forEach(link => {
                            pendingTocLinks.push({
                                page: currentPage,
                                target: link.target,
                                x: x + link.x,
                                y: cursorY + link.y,
                                w: link.w,
                                h: link.h
                            });
                        });
                    }
                    hasContentOnPage = true;

                    if (block.isCover) {
                        if (i < blocks.length - 1) addNewPage();
                    } else if (block.isSummary) {
                        if (i < blocks.length - 1) addNewPage();
                    } else if (block.isToc) {
                        if (i < blocks.length - 1) addNewPage();
                    } else {
                        cursorY += block.height + (block.isGroupHeader ? 3 : gap);
                    }
                }

                pendingTocLinks.forEach(link => {
                    const targetPage = cardPageMap.get(link.target);
                    if (!targetPage) return;
                    pdf.setPage(link.page);
                    pdf.link(link.x, link.y, link.w, link.h, { pageNumber: targetPage });
                });

                return pdf.output('blob');
            } finally {
                renderRoot.remove();
            }
        }

        async function exportPDFByGroup(btn = null) {
            if (ordersData.length === 0) { showToast("没有可导出的数据！"); return; }
            const groupField = getActiveAuditGroupField();
            if (!groupField) {
                AppDialog.alert("当前审计模板未设置有效的分组字段，无法按分组导出。", { title: "无法导出", tone: "warning" });
                return;
            }
            const groups = buildAuditGroups(ordersData, groupField).filter(group => group.rows.length > 0);
            if (!groups.length) {
                showToast("当前没有可按分组导出的数据。");
                return;
            }
            if (!window.JSZip) {
                AppDialog.alert("缺少压缩依赖 JSZip，请检查网络后重试。", { title: "导出失败", tone: "error" });
                return;
            }

            const zip = new JSZip();
            const originalText = btn ? btn.innerText : '';
            if (btn) {
                btn.disabled = true;
                btn.innerText = tText('正在生成分组 PDF...', 'Generating group PDFs...');
            }
            try {
                for (let i = 0; i < groups.length; i++) {
                    const group = groups[i];
                    if (btn) btn.innerText = tText(`生成 PDF ${i + 1}/${groups.length}`, `Generating PDF ${i + 1}/${groups.length}`);
                    const report = exportPDF({ rows: group.rows, groupField, groupValue: group.value, returnHtml: true });
                    const blob = await generatePdfBlobFromHtml(report.html);
                    zip.file(report.filename, blob);
                }
                if (btn) btn.innerText = tText('正在压缩下载...', 'Compressing download...');
                const zipBlob = await zip.generateAsync({ type: 'blob' });
                const title = activeConfig ? activeConfig.name : 'PR审计报告';
                downloadBlob(zipBlob, sanitizeFileName(`${title}_${groupField}_分组PDF.zip`));
            } catch (err) {
                console.error('按分组批量导出 PDF 失败', err);
                AppDialog.alert(`按分组批量导出 PDF 失败：${err.message}`, { title: '导出失败', tone: 'error' });
            } finally {
                if (btn) {
                    btn.disabled = false;
                    restoreI18nButtonLabel(btn, '📚 按分组导出 PDF', '📚 Export PDF by Group');
                }
            }
        }

        // ================== Excel 解析与导入核心引擎 ==================
        function updateFileName(input) {
            const nameLabel = document.getElementById('excelFileName');
            const files = Array.from(input.files || []);
            if (files.length > 0) {
                const previewNames = files.slice(0, 3).map(file => file.name).join('、');
                const suffix = files.length > 3 ? tText(` 等 ${files.length} 个文件`, ` and ${files.length} files`) : '';
                nameLabel.innerText = tText(`已选择: ${previewNames}${suffix}`, `Selected: ${previewNames}${suffix}`);
                nameLabel.style.color = "var(--success-color)";
            } else {
                nameLabel.innerText = tText("未选择任何文件...", "No file selected..."); nameLabel.style.color = "#888";
            }
        }

        function parseExcelFile(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = function (e) {
                    try {
                        const data = new Uint8Array(e.target.result);
                        const workbook = XLSX.read(data, { type: 'array' });
                        const firstSheetName = workbook.SheetNames[0];
                        if (!firstSheetName) {
                            resolve({ fileName: file.name, rows: [] });
                            return;
                        }
                        const worksheet = workbook.Sheets[firstSheetName];
                        const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
                        resolve({ fileName: file.name, rows });
                    } catch (err) {
                        reject(new Error(`${file.name}: ${err.message}`));
                    }
                };
                reader.onerror = () => reject(new Error(`${file.name}: 文件读取失败`));
                reader.readAsArrayBuffer(file);
            });
        }

        function processExcelImport() {
            const fileInput = document.getElementById('excelFileInput');
            const files = Array.from(fileInput.files || []);

            if (files.length === 0) { showToast("请先点击虚线框选择一个或多个 Excel 文件！"); return; }
            if (typeof XLSX === 'undefined') { AppDialog.alert("核心库尚未加载，请确保电脑已联网。如果刚刚打开页面，请稍等1-2秒再试。", { title: "依赖未就绪", tone: "warning" }); return; }

            Promise.all(files.map(parseExcelFile)).then(results => {
                const candidates = [];
                let totalParsedRows = 0;
                const emptyFiles = [];

                results.forEach(result => {
                    const jsonData = result.rows || [];
                    totalParsedRows += jsonData.length;
                    if (jsonData.length === 0) {
                        emptyFiles.push(result.fileName);
                        return;
                    }

                    jsonData.forEach(row => {
                        // Dynamically resolve primary key
                        let taskId = row[ALL_FIELDS[0]];
                        if (!taskId) { const keys = Object.keys(row); if (keys.length > 0) taskId = row[keys[0]]; }
                        if (!taskId) return;

                        taskId = String(taskId).trim();
                        let baseData = {};
                        Object.keys(row).forEach(key => {
                            const normalizedKey = String(key || '').trim();
                            if (normalizedKey) baseData[normalizedKey] = String(row[key] || '').trim();
                        });
                        candidates.push({ id: taskId, baseData });
                    });
                });

                if (totalParsedRows === 0) { AppDialog.alert("检测到所选文件为空或没有符合格式的数据！", { title: "无可导入数据", tone: "warning" }); return; }
                if (candidates.length === 0) { AppDialog.alert("没有识别到有效单号，请检查首列/主键字段是否有值。", { title: "无可导入数据", tone: "warning" }); return; }
                const filterResult = applyImportFilterRules(candidates);
                if (filterResult.items.length === 0) {
                    AppDialog.alert(`模板过滤条件已生效，但过滤后没有剩余单据。\n原始有效单据：${candidates.length} 条\n过滤掉：${filterResult.filteredOut} 条`, { title: '无剩余单据', tone: 'warning' });
                    return;
                }
                openSampleImportModal(filterResult.items, {
                    fileCount: files.length,
                    emptyFiles,
                    originalCount: candidates.length,
                    filteredOut: filterResult.filteredOut,
                    appliedFilterRules: filterResult.appliedRules
                });
            }).catch(err => {
                console.error(err);
                AppDialog.alert("文件解析失败，请确保上传的是标准 Excel！\n" + err.message, { title: "解析失败", tone: "error" });
            });
        }

        function buildImportedOrder(item) {
            const newObj = {
                id: item.id,
                baseData: item.baseData,
                checks: {},
                reasons: {},
                images: {}
            };
            CHECK_POINTS.forEach(cp => {
                newObj.checks[cp.key] = 'none';
                newObj.reasons[cp.key] = '';
                newObj.images[cp.key] = '';
            });
            return newObj;
        }

        function resolveImportGroupField(candidates) {
            const configuredField = activeConfig && activeConfig.groupField ? String(activeConfig.groupField).trim() : '';
            if (!configuredField) return '';

            const normalizeFieldName = (value) => String(value || '').replace(/\s+/g, '').toLowerCase();
            const configuredNormalized = normalizeFieldName(configuredField);
            const importedFields = new Set();

            candidates.forEach(item => {
                Object.keys(item.baseData || {}).forEach(key => importedFields.add(key));
            });

            if (importedFields.has(configuredField)) return configuredField;
            return Array.from(importedFields).find(key => normalizeFieldName(key) === configuredNormalized) || '';
        }

        function resolveImportedFieldName(item, configuredField) {
            if (!item || !item.baseData || !configuredField) return '';
            const normalizedConfigured = String(configuredField).replace(/\s+/g, '').toLowerCase();
            if (Object.prototype.hasOwnProperty.call(item.baseData, configuredField)) return configuredField;
            return Object.keys(item.baseData).find(key => String(key).replace(/\s+/g, '').toLowerCase() === normalizedConfigured) || '';
        }

        function splitRuleValues(value) {
            return String(value || '')
                .split(/[,，;；\n]/)
                .map(v => v.trim())
                .filter(Boolean);
        }

        function matchesFilterRule(item, rule) {
            const fieldName = resolveImportedFieldName(item, rule.field);
            const rawValue = fieldName ? String(item.baseData[fieldName] || '').trim() : '';
            const normalizedValue = rawValue.toLowerCase();
            const values = splitRuleValues(rule.values).map(v => v.toLowerCase());

            if (rule.operator === 'empty') return rawValue === '';
            if (rule.operator === 'not_empty') return rawValue !== '';
            if (values.length === 0) return false;
            if (rule.operator === 'contains') return values.some(v => normalizedValue.includes(v));
            return values.some(v => normalizedValue === v);
        }

        function applyImportFilterRules(candidates) {
            const rules = Array.isArray(activeConfig && activeConfig.filterRules)
                ? activeConfig.filterRules.filter(rule => rule && rule.field && rule.action && rule.operator)
                : [];
            if (!rules.length) {
                return { items: candidates, filteredOut: 0, appliedRules: [] };
            }

            const items = candidates.filter(item => rules.every(rule => {
                const matched = matchesFilterRule(item, rule);
                return rule.action === 'exclude' ? !matched : matched;
            }));
            return {
                items,
                filteredOut: candidates.length - items.length,
                appliedRules: rules
            };
        }

        function openSampleImportModal(candidates, meta = {}) {
            const uniqueMap = new Map();
            candidates.forEach(item => uniqueMap.set(item.id, item));
            const uniqueCandidates = Array.from(uniqueMap.values());
            const existingCount = uniqueCandidates.filter(item => ordersData.some(o => o.id === item.id)).length;
            const newCount = uniqueCandidates.length - existingCount;
            const sampleGroupField = resolveImportGroupField(uniqueCandidates);

            pendingImportBatch = {
                candidates: uniqueCandidates,
                totalRows: candidates.length,
                fileCount: meta.fileCount || 1,
                emptyFiles: meta.emptyFiles || [],
                originalCount: meta.originalCount || candidates.length,
                filteredOut: meta.filteredOut || 0,
                appliedFilterRules: meta.appliedFilterRules || [],
                newCount,
                updateCount: existingCount,
                groupField: sampleGroupField,
                configuredGroupField: activeConfig && activeConfig.groupField ? activeConfig.groupField : ''
            };

            selectedSampleCount = Math.min(uniqueCandidates.length, getDefaultSampleCount(uniqueCandidates.length));
            renderSampleImportModal();
            closeModal('importModal');
            openModal('sampleModal');
        }

        function getDefaultSampleCount(total) {
            if (total <= 10) return total;
            if (total <= 30) return 10;
            if (total <= 80) return 20;
            return 30;
        }

        function getSampleQuickCounts(total) {
            const values = [10, 20, 30, 50].filter(v => v < total);
            values.push(total);
            return Array.from(new Set(values));
        }

        function renderSampleImportModal() {
            if (!pendingImportBatch) return;
            const total = pendingImportBatch.candidates.length;
            const summary = document.getElementById('sampleSummary');
            const options = document.getElementById('sampleOptions');
            const customInput = document.getElementById('sampleCustomCount');
            const rangeHint = document.getElementById('sampleRangeHint');

            summary.innerHTML = currentLang === 'en'
                ? `
                    Parsed <strong>${pendingImportBatch.fileCount}</strong> file(s), recognized <strong>${pendingImportBatch.totalRows}</strong> valid row(s), and <strong>${total}</strong> unique ticket(s).<br>
                    Expected to add <strong>${pendingImportBatch.newCount}</strong> and update <strong>${pendingImportBatch.updateCount}</strong>.
                    ${pendingImportBatch.emptyFiles.length ? `<div class="sample-strategy-note">Note: ${pendingImportBatch.emptyFiles.length} file(s) were empty or had no recognized data and were skipped automatically.</div>` : ''}
                    ${pendingImportBatch.appliedFilterRules.length ? `<div class="sample-strategy-note">Import filters: applied <strong>${pendingImportBatch.appliedFilterRules.length}</strong> template rule(s); original valid tickets <strong>${pendingImportBatch.originalCount}</strong>, filtered out <strong>${pendingImportBatch.filteredOut}</strong>.</div>` : ''}
                    ${pendingImportBatch.groupField ? `<div class="sample-strategy-note">Sampling strategy: balance sampling by <strong>${escapeHtmlText(pendingImportBatch.groupField)}</strong> as evenly as possible, so each group gets a similar sample size first.</div>` : `<div class="sample-strategy-note">Sampling strategy: ${pendingImportBatch.configuredGroupField ? `template group field <strong>${escapeHtmlText(pendingImportBatch.configuredGroupField)}</strong> is configured, but no matching header was found in the imported file, so normal random sampling is used this time.` : 'no valid group field is configured, so normal random sampling is used this time.'}</div>`}
                `
                : `
                    已解析 <strong>${pendingImportBatch.fileCount}</strong> 个文件，识别有效行 <strong>${pendingImportBatch.totalRows}</strong> 行，有效唯一单据 <strong>${total}</strong> 条。<br>
                    预计新增 <strong>${pendingImportBatch.newCount}</strong> 条，更新已有 <strong>${pendingImportBatch.updateCount}</strong> 条。
                    ${pendingImportBatch.emptyFiles.length ? `<div class="sample-strategy-note">提示：${pendingImportBatch.emptyFiles.length} 个文件为空或未识别到数据，已自动跳过。</div>` : ''}
                    ${pendingImportBatch.appliedFilterRules.length ? `<div class="sample-strategy-note">导入过滤：已应用 <strong>${pendingImportBatch.appliedFilterRules.length}</strong> 条模板过滤条件；原始有效单据 <strong>${pendingImportBatch.originalCount}</strong> 条，过滤掉 <strong>${pendingImportBatch.filteredOut}</strong> 条。</div>` : ''}
                    ${pendingImportBatch.groupField ? `<div class="sample-strategy-note">抽样策略：按 <strong>${escapeHtmlText(pendingImportBatch.groupField)}</strong> 尽量均衡抽取，各分组会优先获得接近相等的抽查数量。</div>` : `<div class="sample-strategy-note">抽样策略：${pendingImportBatch.configuredGroupField ? `模板已设置分组字段 <strong>${escapeHtmlText(pendingImportBatch.configuredGroupField)}</strong>，但导入文件中未找到同名表头，本次使用普通随机抽样。` : '未设置有效分组字段，本次使用普通随机抽样。'}</div>`}
                `;

            options.innerHTML = getSampleQuickCounts(total).map(count => {
                const label = count === total ? tText(`全部 ${total}`, `All ${total}`) : tText(`抽查 ${count}`, `Sample ${count}`);
                const active = selectedSampleCount === count ? ' active' : '';
                return `<button type="button" class="sample-option${active}" onclick="setSampleCount(${count})">${label}</button>`;
            }).join('');

            customInput.max = String(total);
            customInput.value = String(selectedSampleCount);
            rangeHint.innerText = tText(`范围 1-${total}`, `Range 1-${total}`);
        }

        function setSampleCount(value) {
            if (!pendingImportBatch) return;
            const total = pendingImportBatch.candidates.length;
            const count = Math.max(1, Math.min(total, parseInt(value, 10) || 1));
            selectedSampleCount = count;
            renderSampleImportModal();
        }

        function selectSampleAll() {
            if (!pendingImportBatch) return;
            selectedSampleCount = pendingImportBatch.candidates.length;
            renderSampleImportModal();
        }

        function pickRandomSample(items, count) {
            if (count >= items.length) return items.slice();
            const shuffled = items.slice();
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            return shuffled.slice(0, count);
        }

        function pickBalancedGroupSample(items, count, groupField) {
            if (!groupField || count >= items.length) return pickRandomSample(items, count);

            const groups = new Map();
            items.forEach(item => {
                const groupValue = item.baseData && item.baseData[groupField] ? item.baseData[groupField] : '未填写';
                if (!groups.has(groupValue)) groups.set(groupValue, []);
                groups.get(groupValue).push(item);
            });

            const buckets = Array.from(groups.entries())
                .map(([groupValue, groupItems]) => ({
                    groupValue,
                    items: pickRandomSample(groupItems, groupItems.length),
                    picked: []
                }))
                .sort((a, b) => String(a.groupValue).localeCompare(String(b.groupValue), 'zh-CN'));

            if (buckets.length === 0) return [];

            const baseQuota = Math.floor(count / buckets.length);
            let remaining = count;

            buckets.forEach(bucket => {
                const take = Math.min(baseQuota, bucket.items.length);
                bucket.picked = bucket.items.splice(0, take);
                remaining -= take;
            });

            while (remaining > 0) {
                const availableBuckets = buckets.filter(bucket => bucket.items.length > 0);
                if (availableBuckets.length === 0) break;

                availableBuckets.sort((a, b) => {
                    if (a.picked.length !== b.picked.length) return a.picked.length - b.picked.length;
                    return b.items.length - a.items.length;
                });

                const bucket = availableBuckets[0];
                bucket.picked.push(bucket.items.shift());
                remaining--;
            }

            return pickRandomSample(buckets.flatMap(bucket => bucket.picked), count);
        }

        function confirmSampleImport() {
            if (!pendingImportBatch) return;
            const pickedItems = pickBalancedGroupSample(pendingImportBatch.candidates, selectedSampleCount, pendingImportBatch.groupField);
            let importCount = 0;
            let updateCount = 0;

            pickedItems.forEach(item => {
                const existIdx = ordersData.findIndex(o => o.id === item.id);
                if (existIdx > -1) {
                    ordersData[existIdx].baseData = { ...ordersData[existIdx].baseData, ...item.baseData };
                    updateCount++;
                } else {
                    ordersData.push(buildImportedOrder(item));
                    importCount++;
                }
            });

            saveToStorage();
            renderTable();
            closeModal('sampleModal');
            resetImportState();
            showToast(tText(`抽查导入完成：本次纳入 ${pickedItems.length} 条，新增 ${importCount} 条，更新 ${updateCount} 条。`, `Sample import completed: included ${pickedItems.length}, added ${importCount}, updated ${updateCount}.`));
        }

        function cancelSampleImport() {
            closeModal('sampleModal');
            resetImportState();
            showToast(tText("已取消本次 Excel 导入。", "This Excel import has been cancelled."));
        }

        function resetImportState() {
            pendingImportBatch = null;
            selectedSampleCount = 0;
            const fileInput = document.getElementById('excelFileInput');
            if (fileInput) {
                fileInput.value = '';
                updateFileName(fileInput);
            }
        }

        // ================== 基础交互 ==================
        function initColConfig() {
            const grid = document.getElementById('colsGrid'); grid.innerHTML = '';
            ALL_FIELDS.forEach(field => {
                const isChecked = visibleCols.includes(field) ? 'checked' : '';
                grid.innerHTML += `<label><input type="checkbox" value="${field}" class="col-chk" ${isChecked}> ${field}</label>`;
            });
        }

        function saveConfig() {
            const checkboxes = document.querySelectorAll('.col-chk:checked');
            let newCols = []; checkboxes.forEach(cb => newCols.push(cb.value));
            if (newCols.length === 0) { showToast("请至少保留一列！"); return; }
            visibleCols = newCols; localStorage.setItem(STORAGE_KEY_COLS, JSON.stringify(visibleCols));
            renderTable(); closeModal('configModal');
        }

        function openDetail(idx) {
            const data = ordersData[idx].baseData; const grid = document.getElementById('detailGrid'); grid.innerHTML = '';
            ALL_FIELDS.forEach(field => { grid.innerHTML += `<div class="detail-item"><span class="label">${field}</span><span class="val">${data[field] || '-'}</span></div>`; });
            openModal('detailModal');
        }

        async function removeRow(idx) {
            const en = typeof currentLang !== 'undefined' && currentLang === 'en';
            const msg = en ? "Confirm delete this row and images?" : "确定删除此单数据及截图吗？";
            if (await AppDialog.confirm(msg, { title: en ? 'Delete row' : '删除单据', tone: 'danger', confirmText: en ? 'Delete' : '删除', cancelText: en ? 'Cancel' : '取消' })) { ordersData.splice(idx, 1); saveToStorage(); renderTable(); }
        }

        function passAll(idx) {
            CHECK_POINTS.forEach(cp => {
                ordersData[idx].checks[cp.key] = 'pass';
                ordersData[idx].reasons[cp.key] = '';
            });
            saveToStorage();
            renderTable();
        }

        async function failAll(idx) {
            const en = typeof currentLang !== 'undefined' && currentLang === 'en';
            const msg = en
                ? "Please enter the failure reason (will apply to all checkpoints):"
                : "请输入一键不通过的理由 (将应用到所有检查点)：";
            const reason = await AppDialog.prompt(msg, { title: en ? 'Fail all checkpoints' : '一键不通过', multiline: true, confirmText: en ? 'OK' : '确定', cancelText: en ? 'Cancel' : '取消' });
            if (!reason) return;

            CHECK_POINTS.forEach(cp => {
                ordersData[idx].checks[cp.key] = 'fail';
                ordersData[idx].reasons[cp.key] = reason;
            });
            saveToStorage();
            renderTable();
        }

        async function clearAllData() {
            const en = typeof currentLang !== 'undefined' && currentLang === 'en';
            const msg = en ? "[Danger] Clear all data permanently?" : "【危险】确定清空所有单号与图片吗？不可逆转！";
            if (await AppDialog.confirm(msg, { title: en ? 'Clear all data' : '清空数据', tone: 'danger', confirmText: en ? 'Clear' : '清空', cancelText: en ? 'Cancel' : '取消' })) { ordersData = []; saveToStorage(); renderTable(); }
        }
        function openModal(id) {
            const modal = document.getElementById(id);
            if (!modal) return;
            modal.style.display = 'flex';
        }
        function closeModal(id) {
            const modal = document.getElementById(id);
            if (!modal) return;
            modal.style.display = 'none';
        }

        // ================== 自定义向导引擎 ==================
        let wizHeaders = [];
        let wizCpCounter = 0;
        let editingConfigId = null;
        let wizFilterRules = [];
        let wizReportFieldOrder = [];
        let wizSelectedFields = new Set();
        let wizFieldSearchKeyword = '';
        let wizReportFieldSearchKeyword = '';

        function tText(zh, en) {
            return currentLang === 'en' ? en : zh;
        }

        function normalizeSearchKeyword(value) {
            return String(value || '').trim().toLowerCase();
        }

        function filterWizardFields(fields, keyword) {
            const normalized = normalizeSearchKeyword(keyword);
            if (!normalized) return fields.slice();
            return fields.filter(field => String(field || '').toLowerCase().includes(normalized));
        }

        function getWizardCheckedFields() {
            return wizHeaders.filter(field => wizSelectedFields.has(field));
        }

        function renderWizardFieldGrid() {
            const grid = document.getElementById('wizFieldsGrid');
            const meta = document.getElementById('wizFieldMeta');
            if (!grid) return;
            if (!wizHeaders.length) {
                grid.innerHTML = '<span data-i18n="暂无解析出的字段">暂无解析出的字段</span>';
                if (meta) meta.innerText = tText('尚未解析到字段。', 'No fields parsed yet.');
                refreshWizardCollapsibleSections();
                return;
            }

            const filteredFields = filterWizardFields(wizHeaders, wizFieldSearchKeyword);
            if (meta) {
                meta.innerText = tText(
                    `已选 ${getWizardCheckedFields().length} / 全部 ${wizHeaders.length}；当前显示 ${filteredFields.length} 个字段`,
                    `Selected ${getWizardCheckedFields().length} / Total ${wizHeaders.length}; showing ${filteredFields.length} fields`
                );
            }

            if (!filteredFields.length) {
                grid.innerHTML = `<span style="color:#666;">${tText('没有匹配的字段。', 'No matching fields.')}</span>`;
                refreshWizardCollapsibleSections();
                return;
            }

            grid.innerHTML = filteredFields.map(field => `
                <label><input type="checkbox" value="${escapeHtmlText(field)}" class="wiz-field-chk" ${wizSelectedFields.has(field) ? 'checked' : ''} onchange="toggleWizardField(this)"> ${escapeHtmlText(field)}</label>
            `).join('');
            refreshWizardCollapsibleSections();
        }

        function renderWizardReportFieldMeta(checkedFields, filteredFields) {
            const meta = document.getElementById('wizReportFieldMeta');
            if (!meta) return;
            if (!checkedFields.length) {
                meta.innerText = tText('请先在第二步勾选字段。', 'Please select fields in Step 2 first.');
                return;
            }
            meta.innerText = tText(
                `已选顶部字段 ${wizReportFieldOrder.length} / 6；候选 ${checkedFields.length}；当前显示 ${filteredFields.length}`,
                `Selected top fields ${wizReportFieldOrder.length} / 6; candidates ${checkedFields.length}; showing ${filteredFields.length}`
            );
        }

        function setWizardFieldSearch(value) {
            wizFieldSearchKeyword = value || '';
            renderWizardFieldGrid();
        }

        function setWizardReportFieldSearch(value) {
            wizReportFieldSearchKeyword = value || '';
            updateReportFieldsUI();
        }

        function toggleWizardField(el) {
            if (!el) return;
            if (el.checked) wizSelectedFields.add(el.value);
            else wizSelectedFields.delete(el.value);
            handleWizardFieldChange();
        }

        function setWizardVisibleFields(checked) {
            const filteredFields = filterWizardFields(wizHeaders, wizFieldSearchKeyword);
            filteredFields.forEach(field => {
                if (checked) wizSelectedFields.add(field);
                else wizSelectedFields.delete(field);
            });
            handleWizardFieldChange();
        }

        function setVisibleReportFields(checked) {
            const checkedFields = getWizardCheckedFields();
            const filteredFields = filterWizardFields(checkedFields, wizReportFieldSearchKeyword);
            if (!checked) {
                wizReportFieldOrder = wizReportFieldOrder.filter(field => !filteredFields.includes(field));
                updateReportFieldsUI();
                return;
            }
            const nextOrder = wizReportFieldOrder.slice();
            filteredFields.forEach(field => {
                if (nextOrder.length >= 6) return;
                if (!nextOrder.includes(field)) nextOrder.push(field);
            });
            wizReportFieldOrder = nextOrder.slice(0, 6);
            if (filteredFields.length > 6 || filteredFields.some(field => !wizReportFieldOrder.includes(field))) {
                showToast(tText('PDF 顶部字段最多只能保留 6 个，已按当前筛选优先勾选前 6 个。', 'PDF top fields can keep up to 6 items. The first 6 visible results were selected.'));
            }
            updateReportFieldsUI();
        }

        function openWizard() {
            editingConfigId = null;
            const titleEl = document.querySelector('#wizardModal h3 span[data-i18n]');
            if(titleEl) {
                titleEl.setAttribute('data-i18n', '✨ 自定义新审计模板');
                titleEl.innerText = tText('✨ 自定义新审计模板', I18N_DICT['✨ 自定义新审计模板']);
            }
            document.getElementById('wizName').value = '';
            document.getElementById('wizFileInput').value = '';
            document.getElementById('wizHeadersBox').innerHTML = '';
            document.getElementById('wizFieldsGrid').innerHTML = '<span data-i18n="暂无解析出的字段">暂无解析出的字段</span>';
            document.getElementById('wizFieldsGrid').dataset.expanded = 'false';
            document.getElementById('wizReportFieldsBox').innerHTML = '<span style="color:#666;" data-i18n="(请先在上方勾选关注的字段)">(请先在上方勾选关注的字段)</span>';
            document.getElementById('wizReportFieldsBox').dataset.expanded = 'false';
            document.getElementById('wizReportFieldsSortBox').innerHTML = '';
            document.getElementById('wizFieldSearchInput').value = '';
            document.getElementById('wizReportFieldSearchInput').value = '';
            wizReportFieldOrder = [];
            wizSelectedFields = new Set();
            wizFieldSearchKeyword = '';
            wizReportFieldSearchKeyword = '';
            updateGroupFieldUI([], '');
            wizFilterRules = [];
            renderFilterRulesUI();
            wizHeaders = [];
            document.getElementById('wizCheckpointsContainer').innerHTML = '';
            wizCpCounter = 0;
            wizAddCheckpoint();
            openModal('wizardModal');
        }

        function editWizard() {
            if (!activeConfig || activeConfig.id === 'rc_audit_default') return;
            editingConfigId = activeConfig.id;

            const titleEl = document.querySelector('#wizardModal h3 span[data-i18n]');
            if(titleEl) {
                titleEl.setAttribute('data-i18n', '✨ 编辑审计模板');
                titleEl.innerText = tText('✨ 编辑审计模板', I18N_DICT['✨ 编辑审计模板']);
            }

            document.getElementById('wizName').value = activeConfig.name;
            document.getElementById('wizFileInput').value = '';
            document.getElementById('wizHeadersBox').innerHTML = `<span style="color:#27ae60;">${tText('(当前已存在映射字段，若需更换请重新上传 Excel)', '(Existing mapped fields are loaded. Upload a new sample Excel if you need to replace them.)')}</span>`;
            document.getElementById('wizFieldsGrid').dataset.expanded = 'false';
            document.getElementById('wizReportFieldsBox').dataset.expanded = 'false';
            document.getElementById('wizFieldSearchInput').value = '';
            document.getElementById('wizReportFieldSearchInput').value = '';
            wizFieldSearchKeyword = '';
            wizReportFieldSearchKeyword = '';

            logTemplateSaveStep('打开编辑模板，载入当前模板状态', {
                id: activeConfig.id,
                name: activeConfig.name,
                fields: activeConfig.fields || [],
                allFields: activeConfig.allFields || activeConfig.fields || [],
                reportFields: activeConfig.reportFields || [],
                groupField: activeConfig.groupField || '',
                filterRules: activeConfig.filterRules || []
            });

            wizHeaders = activeConfig.allFields || activeConfig.fields || [];
            wizSelectedFields = new Set(activeConfig.fields || []);
            renderWizardFieldGrid();
            updateReportFieldsUI(activeConfig.reportFields || []);
            refreshWizardCollapsibleSections();
            updateGroupFieldUI(null, activeConfig.groupField || '');
            wizFilterRules = Array.isArray(activeConfig.filterRules) ? JSON.parse(JSON.stringify(activeConfig.filterRules)) : [];
            renderFilterRulesUI();

            document.getElementById('wizCheckpointsContainer').innerHTML = '';
            wizCpCounter = 0;
            const reasonTemplateMap = normalizeReasonTemplates(activeConfig.reasonTemplates || {});
            const existingCheckpoints = activeConfig.checkpoints || [];
            wizCpCounter = Math.max(0, ...existingCheckpoints.map(cp => {
                const match = String(cp.key || '').match(/^c(\d+)$/);
                return match ? Number(match[1]) : 0;
            }));
            existingCheckpoints.forEach(cp => {
                const cpReasons = reasonTemplateMap[cp.key] || [];
                document.getElementById('wizCheckpointsContainer').appendChild(createWizardCheckpointElement({
                    key: cp.key,
                    name: cp.name,
                    nameEn: cp.nameEn,
                    desc: cp.desc,
                    descEn: cp.descEn,
                    reasons: cpReasons
                }));
            });
            renumberWizardCheckpoints();

            openModal('wizardModal');
        }

        async function deleteWizardConfig() {
            if (!activeConfig || activeConfig.id === 'rc_audit_default') return;
            const langConfirm = currentLang === 'en'
                ? `Are you sure you want to permanently delete the template "${activeConfig.name}"?\nNote: All associated local test data will also be cleared!`
                : `确定要永久删除审计模板【${activeConfig.name}】吗？\n注意：与之关联的本地测试数据也会被一同清除！`;

            if (!await AppDialog.confirm(langConfirm, { title: currentLang === 'en' ? 'Delete template' : '删除审计模板', tone: 'danger', confirmText: currentLang === 'en' ? 'Delete' : '删除', cancelText: currentLang === 'en' ? 'Cancel' : '取消' })) return;

            try {
                await API.delete('/api/praudit/configs/' + activeConfig.id);
                // 清除绑定的本地数据
                const workspace = getAuditWorkspaceForConfig(activeConfig);
                await localforage.removeItem(getWorkspaceDataKey(workspace.id));
                localStorage.removeItem(getWorkspaceDataKey(workspace.id));
                localStorage.removeItem(getWorkspaceColsKey(workspace.id));
                await localforage.removeItem(getLegacyConfigDataKey(activeConfig.id));
                localStorage.removeItem(getLegacyConfigDataKey(activeConfig.id));
                localStorage.removeItem(getLegacyConfigColsKey(activeConfig.id));
                removeAuditWorkspaceForConfig(activeConfig.id);

                showToast(currentLang === 'en' ? "Template successfully deleted!" : "模板已成功删除！");

                // 重置选择回默认模板
                localStorage.removeItem('PR_Auditor_LastConfigId');
                await loadConfigs();
            } catch(e) {
                AppDialog.alert((currentLang === 'en' ? "Delete failed: " : "删除失败：") + e.message, { title: currentLang === 'en' ? "Delete failed" : "删除失败", tone: "error", confirmText: currentLang === 'en' ? "OK" : undefined });
            }
        }

        // ================== 图片引擎 ==================
        let activeUploadTarget = null;
        function getScreenshotTargetLabel(target) {
            if (!target || !ordersData[target.rowIndex]) return '';
            const row = ordersData[target.rowIndex];
            const cp = CHECK_POINTS.find(item => item.key === target.cKey);
            const idLabel = currentLang === 'en' ? 'Ticket' : '单号';
            return `${idLabel} ${row.id} / ${cp ? cp.name : target.cKey}`;
        }

        function renderReasonEvidence() {
            const statusEl = document.getElementById('reasonEvidenceStatus');
            const previewBox = document.getElementById('reasonEvidencePreviewBox');
            const previewImg = document.getElementById('reasonEvidencePreviewImg');
            const deleteBtn = document.getElementById('reasonEvidenceDeleteBtn');
            if (!statusEl || !activeUploadTarget || !ordersData[activeUploadTarget.rowIndex]) return;
            const img = ordersData[activeUploadTarget.rowIndex].images?.[activeUploadTarget.cKey];
            statusEl.innerText = img
                ? tText('已附截图证据，导出 PDF 时会展示。', 'Screenshot evidence attached. It will be included in the exported PDF.')
                : tText('未附截图证据。可上传本地图片，或点击后直接粘贴截图。', 'No screenshot evidence attached. Upload a local image, or click paste and then paste a screenshot.');
            if (previewBox) previewBox.classList.toggle('has-image', Boolean(img));
            if (previewImg) previewImg.src = img || '';
            if (deleteBtn) deleteBtn.style.display = img ? 'inline-flex' : 'none';
        }

        function uploadReasonEvidence() {
            if (!activeUploadTarget) return;
            document.getElementById('hiddenFileInput').click();
        }

        function prepareReasonPasteEvidence() {
            if (!activeUploadTarget) return;
            showToast(tText('请现在按 Ctrl+V 粘贴截图。', 'Press Ctrl+V now to paste the screenshot.'));
            renderReasonEvidence();
        }

        function removeReasonEvidence() {
            if (!activeUploadTarget) return;
            const row = ordersData[activeUploadTarget.rowIndex];
            if (!row || !row.images) return;
            row.images[activeUploadTarget.cKey] = '';
            saveToStorage();
            renderReasonEvidence();
            renderTable();
            showToast(tText('截图证据已删除。', 'Screenshot evidence deleted.'));
        }

        function findImageFileFromPaste(event) {
            const items = (event.clipboardData || window.clipboardData)?.items || [];
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf("image") !== -1) {
                    return items[i].getAsFile();
                }
            }
            return null;
        }

        function updateReportFieldsUI(preselected = null) {
            const checkedFields = getWizardCheckedFields();
            const box = document.getElementById('wizReportFieldsBox');
            const sortBox = document.getElementById('wizReportFieldsSortBox');

            if (preselected) {
                wizReportFieldOrder = preselected.filter(field => checkedFields.includes(field)).slice(0, 6);
            } else {
                wizReportFieldOrder = wizReportFieldOrder.filter(field => checkedFields.includes(field));
            }

            if (checkedFields.length === 0) {
                const isEn = typeof currentLang !== 'undefined' && currentLang === 'en';
                box.innerHTML = `<span style="color:#666;">${isEn ? "(Please check monitored fields above first)" : "(请先在上方勾选关注的字段)"}</span>`;
                if (sortBox) sortBox.innerHTML = '';
                renderWizardReportFieldMeta([], []);
                refreshWizardCollapsibleSections();
                return;
            }

            const filteredFields = filterWizardFields(checkedFields, wizReportFieldSearchKeyword);
            renderWizardReportFieldMeta(checkedFields, filteredFields);
            if (!filteredFields.length) {
                box.innerHTML = `<span style="color:#666;">${tText('没有匹配的已勾选字段。', 'No matching selected fields.')}</span>`;
                renderReportFieldSortBox();
                refreshWizardCollapsibleSections();
                return;
            }

            box.innerHTML = '';
            filteredFields.forEach(f => {
                const isChecked = wizReportFieldOrder.includes(f) ? 'checked' : '';
                box.innerHTML += `<label style="cursor:pointer;"><input type="checkbox" value="${escapeHtmlText(f)}" class="wiz-report-chk" ${isChecked} onchange="toggleReportField(this)"> ${escapeHtmlText(f)}</label>`;
            });
            renderReportFieldSortBox();
            refreshWizardCollapsibleSections();
        }

        function renderReportFieldSortBox() {
            const sortBox = document.getElementById('wizReportFieldsSortBox');
            if (!sortBox) return;
            if (!wizReportFieldOrder.length) {
                sortBox.innerHTML = `<span style="color:#666; font-size:12px;">${tText('未选择 PDF 顶部字段。', 'No PDF top fields selected.')}</span>`;
                return;
            }
            sortBox.innerHTML = `
                <div style="font-size:12px; color:#52708c; font-weight:700;">${tText('PDF 顶部字段输出顺序', 'PDF Top Field Output Order')}</div>
                ${wizReportFieldOrder.map((field, idx) => `
                    <div class="report-field-sort-row">
                        <span class="report-field-sort-index">${idx + 1}.</span>
                        <span>${escapeHtmlText(field)}</span>
                        <span class="report-field-sort-actions">
                            <button type="button" class="btn-outline" ${idx === 0 ? 'disabled' : ''} onclick="moveReportField(${idx}, 'up')">${tText('上移', 'Up')}</button>
                            <button type="button" class="btn-outline" ${idx === wizReportFieldOrder.length - 1 ? 'disabled' : ''} onclick="moveReportField(${idx}, 'down')">${tText('下移', 'Down')}</button>
                        </span>
                    </div>
                `).join('')}
            `;
        }

        function toggleReportField(el) {
            if (el.checked) {
                if (wizReportFieldOrder.length >= 6) {
                    showToast(typeof currentLang !== 'undefined' && currentLang === 'en' ? "You can select up to 6 report fields!" : "最多只能选择 6 个报告展示字段！");
                    el.checked = false;
                    return;
                }
                if (!wizReportFieldOrder.includes(el.value)) wizReportFieldOrder.push(el.value);
            } else {
                wizReportFieldOrder = wizReportFieldOrder.filter(field => field !== el.value);
            }
            renderReportFieldSortBox();
        }

        function moveReportField(index, direction) {
            const targetIndex = direction === 'up' ? index - 1 : index + 1;
            if (targetIndex < 0 || targetIndex >= wizReportFieldOrder.length) return;
            [wizReportFieldOrder[index], wizReportFieldOrder[targetIndex]] = [wizReportFieldOrder[targetIndex], wizReportFieldOrder[index]];
            renderReportFieldSortBox();
        }

        function updateGroupFieldUI(checkedFields = null, preselected = null) {
            const select = document.getElementById('wizGroupField');
            if (!select) return;
            const fields = checkedFields || getWizardCheckedFields();
            const currentValue = preselected !== null ? preselected : select.value;
            const emptyLabel = typeof currentLang !== 'undefined' && currentLang === 'en' ? 'No grouping' : '不分组';
            select.innerHTML = `<option value="">${emptyLabel}</option>`;
            fields.forEach(f => {
                const selected = currentValue === f ? 'selected' : '';
                select.innerHTML += `<option value="${escapeHtmlText(f)}" ${selected}>${escapeHtmlText(f)}</option>`;
            });
            if (currentValue && fields.includes(currentValue)) select.value = currentValue;
        }

        function renderFilterRulesUI() {
            const box = document.getElementById('wizFilterRulesBox');
            if (!box) return;
            const fields = getWizardCheckedFields();
            if (!wizFilterRules.length) {
                box.innerHTML = `<span style="color:#666;">${tText('未配置过滤条件', 'No import filters configured')}</span>`;
                return;
            }

            const fieldOptions = fields.map(field => `<option value="${escapeHtmlText(field)}">${escapeHtmlText(field)}</option>`).join('');
            box.innerHTML = wizFilterRules.map((rule, idx) => `
                <div class="filter-rule-row">
                    <select onchange="updateFilterRule(${idx}, 'field', this.value)">
                        <option value="">${tText('选择字段', 'Select field')}</option>
                        ${fieldOptions}
                    </select>
                    <select onchange="updateFilterRule(${idx}, 'action', this.value)">
                        <option value="include">${tText('仅保留匹配', 'Keep matches only')}</option>
                        <option value="exclude">${tText('排除匹配', 'Exclude matches')}</option>
                    </select>
                    <select onchange="updateFilterRule(${idx}, 'operator', this.value)">
                        <option value="equals">${tText('等于任一值', 'Equals any value')}</option>
                        <option value="contains">${tText('包含任一值', 'Contains any value')}</option>
                        <option value="not_empty">${tText('非空', 'Not empty')}</option>
                        <option value="empty">${tText('为空', 'Empty')}</option>
                    </select>
                    <input type="text" value="${escapeHtmlText(rule.values || '')}" placeholder="${tText('例如：已关闭,已解决', 'e.g. Closed,Resolved')}" oninput="updateFilterRule(${idx}, 'values', this.value)">
                    <button type="button" class="btn-danger" style="padding:7px 9px; box-shadow:none;" onclick="removeFilterRule(${idx})">${tText('删除', 'Delete')}</button>
                </div>
            `).join('');

            wizFilterRules.forEach((rule, idx) => {
                const row = box.children[idx];
                if (!row) return;
                row.children[0].value = fields.includes(rule.field) ? rule.field : '';
                row.children[1].value = rule.action || 'include';
                row.children[2].value = rule.operator || 'equals';
            });
        }

        function addFilterRule() {
            const fields = getWizardCheckedFields();
            wizFilterRules.push({
                field: fields[0] || '',
                action: 'include',
                operator: 'equals',
                values: ''
            });
            renderFilterRulesUI();
        }

        function updateFilterRule(index, key, value) {
            if (!wizFilterRules[index]) return;
            wizFilterRules[index][key] = value;
        }

        function removeFilterRule(index) {
            wizFilterRules.splice(index, 1);
            renderFilterRulesUI();
        }

        function handleWizardFieldChange() {
            renderWizardFieldGrid();
            updateReportFieldsUI();
            updateGroupFieldUI();
            const fields = getWizardCheckedFields();
            wizFilterRules = wizFilterRules.map(rule => fields.includes(rule.field) ? rule : { ...rule, field: '' });
            renderFilterRulesUI();
        }

        function limitReportFields(el) {
            toggleReportField(el);
        }

        document.addEventListener('paste', function(event) {
            if (event.defaultPrevented) return;
            if (!activeUploadTarget) return;
            if (document.getElementById('reasonModal')?.style.display !== 'flex') return;
            const activeEl = document.activeElement;
            const isReasonInput = activeEl && activeEl.id === 'reasonInput';
            if (isReasonInput) return;
            const file = findImageFileFromPaste(event);
            if (!file) return;
            processAndSaveImage(file, activeUploadTarget.cKey, activeUploadTarget.rowIndex);
            event.preventDefault();
        });

        document.getElementById('hiddenFileInput').addEventListener('change', function (e) {
            if (e.target.files.length > 0 && activeUploadTarget) {
                processAndSaveImage(e.target.files[0], activeUploadTarget.cKey, activeUploadTarget.rowIndex); this.value = '';
            }
        });

        function processAndSaveImage(file, cKey, rowIndex) {
            const reader = new FileReader();
            reader.onload = function (e) {
                const img = new Image();
                img.onload = function () {
                    const canvas = document.createElement('canvas'); let width = img.width, height = img.height;
                    if (width > 600) { height *= 600 / width; width = 600; }
                    canvas.width = width; canvas.height = height; canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                    ordersData[rowIndex].images[cKey] = canvas.toDataURL('image/jpeg', 0.65);
                    saveToStorage();
                    renderTable();
                    renderReasonEvidence();
                    showToast(tText('截图证据已保存，导出 PDF 时会展示。', 'Screenshot evidence saved and will be shown in the exported PDF.'));
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        }

        async function deleteImage(cKey, rowIndex, event) {
            event.stopPropagation();
            if (await AppDialog.confirm("确定删除此图片吗？", { title: "删除图片", tone: "danger", confirmText: "删除" })) { ordersData[rowIndex].images[cKey] = ""; saveToStorage(); renderTable(); }
        }

        function viewLargeImage(cKey, rowIndex, event) {
            event.stopPropagation(); const src = ordersData[rowIndex].images[cKey];
            if (src) { document.getElementById('modalImg').src = src; openModal('imageModal'); }
        }


        function wizParseHeaders() {
            const fileInput = document.getElementById('wizFileInput');
            const file = fileInput.files[0];
            if (!file) { showToast("请先选择样例 Excel 文件！"); fileInput.focus(); return; }
            if (typeof XLSX === 'undefined') return void AppDialog.alert("缺少 XLSX 依赖。", { title: "依赖未就绪", tone: "error" });

            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];
                    const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

                    if (jsonData.length === 0) return void showToast("文件无数据！");
                    wizHeaders = Object.keys(jsonData[0]);

                    document.getElementById('wizHeadersBox').innerHTML = `成功解析出 ${wizHeaders.length} 个字段：<br>` +
                        wizHeaders.map(h => `<span style="display:inline-block; background:#e9ecef; padding:3px 6px; border-radius:4px; border:1px solid #ddd;">${h}</span>`).join('');

                    wizSelectedFields = new Set(wizHeaders);
                    wizFieldSearchKeyword = '';
                    wizReportFieldSearchKeyword = '';
                    document.getElementById('wizFieldSearchInput').value = '';
                    document.getElementById('wizReportFieldSearchInput').value = '';
                    renderWizardFieldGrid();
                    updateReportFieldsUI();
                    refreshWizardCollapsibleSections();
                    updateGroupFieldUI();
                    renderFilterRulesUI();
                } catch(err) {
                    AppDialog.alert("解析失败，请确保格式正确：" + err.message, { title: "解析失败", tone: "error" });
                }
            };
            reader.readAsArrayBuffer(file);
        }

        function createWizardCheckpointElement(cp = {}) {
            const key = cp.key || getNextWizardCheckpointKey();
            const div = document.createElement('div');
            div.className = 'wizard-checkpoint-row';
            div.style.cssText = "display:flex; gap:10px; background:#f8f9fa; padding:15px; border:1px solid #ddd; border-radius:6px; align-items:flex-start;";
            div.innerHTML = `
                <div class="w-cp-index" style="font-weight:bold; font-size:16px; color:#555; margin-top:5px; min-width:26px;">-</div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; flex:1;">
                    <input type="text" class="w-cp-name" value="${escapeHtmlText(cp.name || '')}" placeholder="${tText('检查点名称 (如: 书面证据，必填)', 'Checkpoint name (e.g. Written Evidence, required)')}" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
                    <input type="text" class="w-cp-name-en" value="${escapeHtmlText(cp.nameEn || '')}" placeholder="${tText('检查点英文翻译 (可选)', 'Checkpoint English name (optional)')}" style="padding:8px; border:1px solid #ccc; border-radius:4px; font-size:12px;">
                    <input type="text" class="w-cp-desc" value="${escapeHtmlText(cp.desc || '')}" placeholder="${tText('规则描述 (如: 需附带客户确认邮件截图)', 'Rule description (e.g. customer confirmation screenshot required)')}" style="padding:8px; border:1px solid #ccc; border-radius:4px;">
                    <input type="text" class="w-cp-desc-en" value="${escapeHtmlText(cp.descEn || '')}" placeholder="${tText('规则描述英文翻译 (可选)', 'Rule description in English (optional)')}" style="padding:8px; border:1px solid #ccc; border-radius:4px; font-size:12px;">
                    <textarea class="w-cp-reasons" placeholder="${tText('该检查点的不通过快捷理由，每行一个', 'Failure reason shortcuts for this checkpoint, one per line')}" style="grid-column:1 / -1; min-height:70px; padding:8px; border:1px solid #ccc; border-radius:4px; font-size:12px; resize:vertical;">${escapeHtmlText((cp.reasons || []).join('\n'))}</textarea>
                </div>
                <div style="display:flex; flex-direction:column; gap:6px;">
                    <button type="button" class="btn-outline w-cp-up" style="padding:6px 10px; font-size:12px; box-shadow:none;" onclick="moveWizardCheckpoint(this, 'up')">${tText('上移', 'Up')}</button>
                    <button type="button" class="btn-outline w-cp-down" style="padding:6px 10px; font-size:12px; box-shadow:none;" onclick="moveWizardCheckpoint(this, 'down')">${tText('下移', 'Down')}</button>
                    <button type="button" class="btn-danger w-cp-delete" style="padding:6px 10px; font-size:12px;" onclick="deleteWizardCheckpoint(this)">${tText('删除', 'Delete')}</button>
                </div>
            `;
            div.dataset.key = key;
            return div;
        }

        function getNextWizardCheckpointKey() {
            const usedKeys = new Set(Array.from(document.querySelectorAll('#wizCheckpointsContainer > div')).map(row => row.dataset.key));
            let key = '';
            do {
                wizCpCounter++;
                key = `c${wizCpCounter}`;
            } while (usedKeys.has(key));
            return key;
        }

        function renumberWizardCheckpoints() {
            const rows = Array.from(document.querySelectorAll('#wizCheckpointsContainer > div'));
            rows.forEach((row, idx) => {
                const indexEl = row.querySelector('.w-cp-index');
                if (indexEl) indexEl.innerText = `${idx + 1}.`;
                const upBtn = row.querySelector('.w-cp-up');
                const downBtn = row.querySelector('.w-cp-down');
                if (upBtn) upBtn.disabled = idx === 0;
                if (downBtn) downBtn.disabled = idx === rows.length - 1;
            });
        }

        function deleteWizardCheckpoint(button) {
            button.closest('.wizard-checkpoint-row')?.remove();
            renumberWizardCheckpoints();
        }

        function moveWizardCheckpoint(button, direction) {
            const row = button.closest('.wizard-checkpoint-row');
            const container = document.getElementById('wizCheckpointsContainer');
            if (!row || !container) return;
            if (direction === 'up' && row.previousElementSibling) {
                container.insertBefore(row, row.previousElementSibling);
            } else if (direction === 'down' && row.nextElementSibling) {
                container.insertBefore(row.nextElementSibling, row);
            }
            renumberWizardCheckpoints();
        }

        function wizAddCheckpoint() {
            document.getElementById('wizCheckpointsContainer').appendChild(createWizardCheckpointElement());
            renumberWizardCheckpoints();
        }

        async function wizSaveConfig() {
            const name = document.getElementById('wizName').value.trim();
            if (!name) { showToast("请输入自定义审计模板名称！"); document.getElementById('wizName').focus(); return; }

            const allCheckboxes = wizHeaders.slice();
            const fields = getWizardCheckedFields();
            if (fields.length === 0) return void showToast("请在第二步中至少勾选一个关注的字段！");
            const uncheckedFields = allCheckboxes.filter(value => !fields.includes(value));

            const fieldsSet = new Set(fields);
            const reportFields = wizReportFieldOrder.filter(field => fieldsSet.has(field)).slice(0, 6);
            const groupField = document.getElementById('wizGroupField')?.value || '';
            const reasonTemplates = {};
            const filterRules = wizFilterRules
                .filter(rule => rule.field && rule.action && rule.operator)
                .map(rule => ({
                    field: rule.field,
                    action: rule.action,
                    operator: rule.operator,
                    values: rule.values || ''
                }));

            const cpDivs = document.getElementById('wizCheckpointsContainer').children;
            const checkpoints = [];
            for (let i = 0; i < cpDivs.length; i++) {
                const div = cpDivs[i];
                const cpName = div.querySelector('.w-cp-name').value.trim();
                if (!cpName) { showToast(`第 ${i+1} 个检查点名称不能为空！`); div.querySelector('.w-cp-name').focus(); return; }
                const cpKey = div.dataset.key;
                const cpReasons = (div.querySelector('.w-cp-reasons')?.value || '')
                    .split(/\n/)
                    .map(v => v.trim())
                    .filter(Boolean);
                checkpoints.push({
                    key: cpKey,
                    name: cpName,
                    nameEn: div.querySelector('.w-cp-name-en').value.trim() || cpName,
                    desc: div.querySelector('.w-cp-desc').value.trim() || '-',
                    descEn: div.querySelector('.w-cp-desc-en').value.trim() || '-'
                });
                reasonTemplates[cpKey] = cpReasons;
            }
            if (checkpoints.length === 0) return void showToast("至少需要定义一个检查点规则！");

            try {
                const payload = { name, fields, allFields: wizHeaders.slice(), checkpoints, reportFields, groupField, filterRules, reasonTemplates };
                if (editingConfigId) payload.id = editingConfigId;

                logTemplateSaveStep('开始保存模板', {
                    editingConfigId: editingConfigId || null,
                    templateName: name,
                    allFieldCount: payload.allFields.length,
                    checkedFieldCount: fields.length,
                    uncheckedFieldCount: uncheckedFields.length,
                    checkedFields: fields,
                    uncheckedFields,
                    reportFields,
                    groupField,
                    filterRules,
                    checkpointCount: checkpoints.length
                });
                logTemplateSaveStep('即将提交的 payload', JSON.parse(JSON.stringify(payload)));

                const res = await API.post('/api/praudit/configs', payload);
                logTemplateSaveStep('保存接口返回成功', JSON.parse(JSON.stringify(res)));
                showToast(editingConfigId ? "模板修改成功！" : "模板创建成功，已保存至服务器！");
                closeModal('wizardModal');

                // Optimistically sync the in-memory config first so reopening the editor
                // immediately after save still reflects the latest checked fields.
                const configIndex = ALL_CONFIGS.findIndex(item => item.id === res.id);
                if (configIndex >= 0) ALL_CONFIGS[configIndex] = res;
                else ALL_CONFIGS.push(res);
                activeConfig = res;
                localStorage.setItem('PR_Auditor_LastConfigId', res.id);

                const diagnostics = await fetchTemplateSaveDiagnostics(res.id);
                logTemplateSaveStep('保存后自动回查模板列表完成', {
                    configCount: diagnostics.configCount,
                    matchedConfig: diagnostics.matched ? {
                        id: diagnostics.matched.id,
                        name: diagnostics.matched.name,
                        fieldCount: Array.isArray(diagnostics.matched.fields) ? diagnostics.matched.fields.length : 0,
                        allFieldCount: Array.isArray(diagnostics.matched.allFields) ? diagnostics.matched.allFields.length : 0,
                        fields: diagnostics.matched.fields || [],
                        allFields: diagnostics.matched.allFields || [],
                        reportFields: diagnostics.matched.reportFields || [],
                        groupField: diagnostics.matched.groupField || '',
                        filterRules: diagnostics.matched.filterRules || []
                    } : null
                });

                await loadConfigs();
                document.getElementById('auditTypeSelector').value = res.id;
                await switchAuditType();
                logTemplateSaveStep('保存后的当前页面状态', {
                    activeConfigId: activeConfig ? activeConfig.id : null,
                    activeConfigName: activeConfig ? activeConfig.name : null,
                    activeFieldCount: activeConfig && Array.isArray(activeConfig.fields) ? activeConfig.fields.length : 0,
                    activeAllFieldCount: activeConfig && Array.isArray(activeConfig.allFields) ? activeConfig.allFields.length : 0,
                    activeFields: activeConfig && activeConfig.fields ? activeConfig.fields : [],
                    activeAllFields: activeConfig && activeConfig.allFields ? activeConfig.allFields : []
                });
            } catch(e) {
                logTemplateSaveStep('保存失败', {
                    message: e && e.message ? e.message : String(e),
                    stack: e && e.stack ? e.stack : ''
                });
                AppDialog.alert("保存模板失败：" + e.message, { title: "保存失败", tone: "error" });
            }
        }

        // ================== 双语切换引擎 ==================
        const I18N_DICT = {
    "PR进展附件记录 - 审计级批量自检系统": "PR Audit - Batch Verification System",
    "PR审计报告系统": "PR Audit System",
    "➕ 自定义新审计模板": "➕ Custom Audit",
    "🧪 一键加载测试数据": "🧪 Load Mock Data",
    "📥 导入 Excel 文件": "📥 Import Excel",
    "📥 导入数据": "📥 Import Data",
    "📦 导入快照": "📦 Import Snapshot",
    "⚙️ 显示设置": "⚙️ Display Settings",
    "📤 导出数据 ▾": "📤 Export Data ▾",
    "⚙️ 列展示设置": "⚙️ Display Columns",
    "🗑️ 清空所有单号": "🗑️ Clear All",
    "导出详细报告 (PDF)": "Export Report (PDF)",
    "✨ 自定义新审计模板": "✨ Custom Audit Template",
    "第一步：上传样例 Excel (提取表头字段)": "Step 1: Upload Sample Excel (Extract Headers)",
    "请上传一份标准的样例数据，我们会自动提取表头供您建立字段映射。": "Please upload a standard sample data file, we will automatically extract headers for mapping.",
    "⚙️ 解析表头": "⚙️ Parse Headers",
    "第二步：选择审计需要关注的字段": "Step 2: Select Fields to Monitor",
    "⚠️ 必看警告：请按顺序勾选！您勾选的【第一个字段】将被强制作为该审计模板的主键/单号！": "⚠️ Warning: Please check in order! The FIRST checked field will be enforced as the primary key/Task ID!",
    "暂无解析出的字段": "No fields parsed yet",
    "搜索字段名称...": "Search field names...",
    "搜索已勾选字段...": "Search selected fields...",
    "全选当前结果": "Select Visible",
    "取消当前结果": "Clear Visible",
    "第三步：定义审计检查点 (Checkpoints)": "Step 3: Define Checkpoints",
    "➕ 新增检查点": "➕ Add Checkpoint",
    "取消": "Cancel",
    "💾 保存并生效": "💾 Save & Apply",
    "模板名称:": "Template Name:",
    "例如：RFC 变更单审计": "e.g., RFC Change Audit",
    "建议先解析样例表头，再按主字段、分组、过滤、PDF 展示字段逐步完成模板配置。": "Start by parsing sample headers, then configure primary fields, grouping, filters, and PDF display fields step by step.",
    "✏️ 编辑模板": "✏️ Edit Template",
    "✨ 编辑审计模板": "✨ Edit Audit Template",
    "🗑️ 删除模板": "🗑️ Delete Template",
    "附加：选择最多 6 个字段在 PDF 报告卡片顶部高亮展示": "Additional: Select up to 6 fields to highlight at the top of PDF report cards",
    "这部分会单独显示在 PDF 顶部信息卡中，建议挑选最关键、最适合快速浏览的字段。": "These fields will appear in a dedicated PDF header card. Choose the most critical items for quick review.",
    "(请先在上方勾选关注的字段)": "(Please check monitored fields above first)",
    "附加：选择一个字段作为审计页面分组展示依据": "Additional: Select one field to group the audit page",
    "例如选择客户群或产品线，审计表会按该字段分段展示。": "For example, choose Customer Group or Product Line to show audit items in grouped sections.",
    "附加：配置导入过滤条件": "Additional: Configure import filters",
    "➕ 新增过滤条件": "➕ Add Filter",
    "多条过滤条件会同时生效；匹配值可用逗号分隔多个值。": "Multiple filters are applied together; separate multiple values with commas.",
    "解析并导入": "Parse & Import",
    "取消目标": "Clear Target",
    "填写未通过理由": "Fill Failure Reason",
    "请简要描述该项不合格的原因，此信息将展示在看板并录入审计报告。": "Briefly describe why this item failed. The reason will be shown in the dashboard and included in the audit report.",
    "快捷理由模板": "Shortcut Reason Templates",
    "手动填写或编辑理由": "Type or Edit Reason",
    "例如：客户邮件中未明确提及产品数量 / 缺少高层审批电子流...": "e.g. Customer email does not clearly mention product quantity / missing executive approval flow...",
    "取消选择": "Cancel",
    "确认未通过": "Confirm Fail",
    "截图证据": "Screenshot Evidence",
    "点击后粘贴截图": "Click, Then Paste",
    "上传本地图片": "Upload Local Image",
    "删除截图": "Delete Image",
    "上传或粘贴后将在这里预览，导出 PDF 时会展示。": "After upload or paste, the preview will appear here and be included in the exported PDF.",
    "📦 导出快照包": "📦 Export Snapshot",
    "🧩 按分组导出快照": "🧩 Export Group Snapshots",
    "📥 导入快照": "📥 Import Snapshot",
    "⏳ 加载配置中...": "⏳ Loading templates...",
    "📄 导出全部为 PDF": "📄 Export All as PDF",
    "📚 按分组导出 PDF": "📚 Export PDF by Group",
    "📊 导出为表格": "📊 Export Spreadsheet",
    "🗑️ 清空数据": "🗑️ Clear Data",
    "导入 Excel 单子数据": "Import Excel Ticket Data",
    "请选择一个或多个包含表头的标准 Excel 文件 (.xlsx 或 .xls) 进行导入分析。": "Please choose one or more standard Excel files with headers (.xlsx or .xls) for import analysis.",
    "点击选择 Excel 文件（可多选）": "Click to choose Excel files (multiple supported)",
    "未选择任何文件...": "No file selected...",
    "未附截图证据": "No screenshot evidence",
    "导入后抽查设置": "Post-import Sampling Setup",
    "可以只抽取一部分单据进入本次审计，降低首次检查压力。若模板设置了分组字段，会优先按分组均衡抽样；已有单据的历史检查状态会保留。": "You can sample only part of the tickets for this audit to reduce initial review effort. If a group field is configured in the template, balanced group sampling is preferred; existing audit history will be preserved.",
    "自定义抽查数量": "Custom sample count",
    "例如 15": "e.g. 15",
    "取消导入": "Cancel Import",
    "全部导入": "Import All",
    "确认抽查导入": "Confirm Sample Import",
    "主表展示列设置": "Main Table Column Settings",
    "保存设置": "Save Settings",
    "单据完整属性表": "Full Ticket Details",
    "📝 模板名称:": "📝 Template Name:",
    "不分组": "No grouping",
    "未配置过滤条件": "No import filters configured",
    "展开更多": "Expand",
    "收起": "Collapse"
};
        let currentLang = 'zh'; // Default, will be updated by event

        function applyLanguage(lang) {
            if (currentLang === lang) return;
            currentLang = lang;

            // 翻译带 data-i18n 的静态元素
            document.querySelectorAll('[data-i18n]').forEach(el => {
                const key = el.getAttribute('data-i18n');
                if (currentLang === 'en' && I18N_DICT[key]) el.innerHTML = I18N_DICT[key];
                else el.innerHTML = key;
            });

            // 翻译 placeholder
            document.querySelectorAll('[data-i18n-ph]').forEach(el => {
                const key = el.getAttribute('data-i18n-ph');
                if (currentLang === 'en' && I18N_DICT[key]) el.placeholder = I18N_DICT[key];
                else el.placeholder = key;
            });

            // 重新渲染表格内容 (表头、按钮、状态等)
            if (activeConfig) renderTable();
            renderActiveWorkspaceInfo();
            refreshWizardDynamicI18n();
            refreshWizardCollapsibleSections();
            const excelFileInput = document.getElementById('excelFileInput');
            if (excelFileInput) updateFileName(excelFileInput);
            if (pendingImportBatch) renderSampleImportModal();
            if (document.getElementById('reasonModal')?.style.display === 'flex') {
                renderReasonTemplates();
                renderReasonEvidence();
            }
        }

        window.addEventListener('tools:languagechange', (e) => {
            const isEn = e.detail?.lang?.startsWith('en');
            applyLanguage(isEn ? 'en' : 'zh');
        });

        // Initialize language immediately on load based on localStorage
        const storedLang = localStorage.getItem('tools_lang') || navigator.language || 'zh';
        applyLanguage(storedLang.startsWith('en') ? 'en' : 'zh');

        function refreshWizardDynamicI18n() {
            renderWizardFieldGrid();
            updateReportFieldsUI();
            renderFilterRulesUI();
            renderReportFieldSortBox();
            refreshWizardCollapsibleSections();
            document.querySelectorAll('#wizCheckpointsContainer > div').forEach(div => {
                const name = div.querySelector('.w-cp-name');
                const nameEn = div.querySelector('.w-cp-name-en');
                const desc = div.querySelector('.w-cp-desc');
                const descEn = div.querySelector('.w-cp-desc-en');
                const reasons = div.querySelector('.w-cp-reasons');
                if (name) name.placeholder = tText('检查点名称 (如: 书面证据，必填)', 'Checkpoint name (e.g. Written Evidence, required)');
                if (nameEn) nameEn.placeholder = tText('检查点英文翻译 (可选)', 'Checkpoint English name (optional)');
                if (desc) desc.placeholder = tText('规则描述 (如: 需附带客户确认邮件截图)', 'Rule description (e.g. customer confirmation screenshot required)');
                if (descEn) descEn.placeholder = tText('规则描述英文翻译 (可选)', 'Rule description in English (optional)');
                if (reasons) reasons.placeholder = tText('该检查点的不通过快捷理由，每行一个', 'Failure reason shortcuts for this checkpoint, one per line');
                const upBtn = div.querySelector('.w-cp-up');
                const downBtn = div.querySelector('.w-cp-down');
                const delBtn = div.querySelector('.w-cp-delete');
                if (upBtn) upBtn.innerText = tText('上移', 'Up');
                if (downBtn) downBtn.innerText = tText('下移', 'Down');
                if (delBtn) delBtn.innerText = tText('删除', 'Delete');
            });
            renumberWizardCheckpoints();
        }

        // 修改 renderTable 中的写死中文
        const oldRenderTable = renderTable;
        renderTable = function() {
            oldRenderTable(); // Render original

            // Translate dynamic table elements if EN
            if (currentLang === 'en') {
                const tBody = document.getElementById('tableBody');
                if (tBody) {
                    tBody.innerHTML = tBody.innerHTML
                        .replace(/暂无自检数据，请点击上方“导入 Excel 文件”开始。/g, 'No data. Please click "Import Excel" to begin.')
                        .replace(/✔通过/g, '✔Pass')
                        .replace(/✘未过/g, '✘Fail')
                        .replace(/✅ 合格/g, '✅ Pass')
                        .replace(/❌ 不合格/g, '❌ Fail')
                        .replace(/⏳ 待检/g, '⏳ Pending')
                        .replace(/详情/g, 'Details')
                        .replace(/删除/g, 'Delete')
                        .replace(/粘贴Ctrl\+V<br>或点此上传/g, 'Paste Ctrl+V<br>or Click to Upload');
                }
            }
            setTimeout(updateFloatingTableHeader, 0);
        };

        // ================== 测试数据生成引擎 ==================
        function createMockImage(text) {
            const canvas = document.createElement('canvas');
            canvas.width = 400; canvas.height = 200;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#f8d7da'; ctx.fillRect(0,0,400,200);
            ctx.fillStyle = '#721c24'; ctx.font = '24px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(text, 200, 100);
            return canvas.toDataURL('image/png');
        }

        async function loadMockData() {
            if (!activeConfig) return void showToast("请先选择或新建一个审计模板！");
            if (ordersData.length > 0) {
                if (!await AppDialog.confirm("加载测试数据会将当前列表追加数据，确定继续吗？", { title: "加载测试数据", confirmText: "继续" })) return;
            }

            const mockDataCount = 6;
            const newOrders = [];
            const titles = ["紧急修复生产环境BUG", "用户数据迁移方案", "优化数据库查询性能", "更新前端依赖组件", "修复登录接口漏洞", "重构旧版接口逻辑"];
            const assignees = ["张三 (Zheng San)", "李四 (Li Si)", "王五 (Wang Wu)", "赵六 (Zhao Liu)", "钱七 (Qian Qi)", "孙八 (Sun Ba)"];

            for (let i = 0; i < mockDataCount; i++) {
                const id = "MOCK-TEST-" + Math.floor(100000 + Math.random() * 900000);
                let baseData = {};
                ALL_FIELDS.forEach((f, idx) => {
                    if (idx === 0) baseData[f] = id;
                    else if (f.includes('标题') || f.includes('Title')) baseData[f] = titles[i % titles.length];
                    else if (f.includes('处理人') || f.includes('Assignee')) baseData[f] = assignees[i % assignees.length];
                    else if (f.includes('状态') || f.includes('Status')) baseData[f] = "已完结";
                    else if (f.includes('延期') || f.includes('Delay')) baseData[f] = "否";
                    else baseData[f] = "模拟数据 " + (i+1);
                });

                const obj = { id, baseData, checks: {}, reasons: {}, images: {} };

                CHECK_POINTS.forEach((cp, cpIdx) => {
                    let state = 'pass';
                    let reason = '';
                    let img = '';

                    // 制造不同的业务场景
                    if (i === 1 && cpIdx === 0) {
                        state = 'fail'; reason = '缺少核心书面证据邮件，无法查验';
                        img = createMockImage('模拟证据缺失占位图');
                    }
                    else if (i === 2 && cpIdx === 1) {
                        state = 'fail'; reason = '截图内容不完整，未体现评审人确认';
                    }
                    else if (i === 3) {
                        state = 'none'; // 待检查
                    }
                    else if (i === 4 && cpIdx % 2 === 0) {
                        state = 'fail'; reason = '严重违规：时间节点不符，涉嫌造假';
                        img = createMockImage('风险异常截图证据');
                    }

                    obj.checks[cp.key] = state;
                    obj.reasons[cp.key] = reason;
                    obj.images[cp.key] = img;
                });

                newOrders.push(obj);
            }

            ordersData = ordersData.concat(newOrders);
            saveToStorage();
            renderTable();
            showToast("成功加载 6 条全场景测试数据！");
        }
