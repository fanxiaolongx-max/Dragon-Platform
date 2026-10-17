/**
 * uivf12/sidebar.js - 侧边栏分类脚本仓库模块
 * 负责：加载脚本数据、渲染折叠分类列表、拖拽分类、双击回填等
 */

const DEFAULT_CATEGORIES = ['DataFab', 'NetCare中国', 'NetCare中东', 'NetCare德国', '默认分类'];

// 展开状态仅保留在内存（不再用 localStorage，服务端不存此状态）
let expandedCategories = [];
let draggedScriptId = null;
let lastScripts = [];
let lastCategories = [];

function logSidebarStep(step, detail) {
    const prefix = '%c[UIVF12 Sidebar]';
    const style = 'color:#38bdf8;font-weight:700;';
    if (detail === undefined) {
        console.info(prefix, style, step);
        return;
    }
    console.info(prefix, style, step, detail);
}

function logSidebarError(step, error, detail) {
    const prefix = '%c[UIVF12 Sidebar]';
    const style = 'color:#ef4444;font-weight:700;';
    console.error(prefix, style, `${step} failed`, detail || '', error);
}

function formatSourceLabel(source) {
    return window.UIVI18n ? UIVI18n.sourceLabel(source) : (source || '-');
}

function showScriptDeleteConfirm(scriptName) {
    const overlay = document.getElementById('uivDeleteConfirmOverlay');
    const dialog = overlay && overlay.querySelector('.uiv-delete-confirm-dialog');
    const nameEl = document.getElementById('uivDeleteConfirmName');
    const cancelBtn = document.getElementById('uivDeleteConfirmCancel');
    const confirmBtn = document.getElementById('uivDeleteConfirmSubmit');
    if (!overlay || !dialog || !nameEl || !cancelBtn || !confirmBtn) {
        return Promise.resolve(false);
    }

    nameEl.textContent = scriptName;
    const previousFocus = document.activeElement;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');

    return new Promise(resolve => {
        let settled = false;
        const finish = confirmed => {
            if (settled) return;
            settled = true;
            overlay.classList.remove('open');
            overlay.setAttribute('aria-hidden', 'true');
            overlay.removeEventListener('click', handleOverlayClick);
            document.removeEventListener('keydown', handleKeydown);
            cancelBtn.onclick = null;
            confirmBtn.onclick = null;
            if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
            resolve(confirmed);
        };
        const handleOverlayClick = event => {
            if (event.target === overlay) finish(false);
        };
        const handleKeydown = event => {
            if (event.key === 'Escape') finish(false);
            if (event.key !== 'Tab') return;
            if (event.shiftKey && document.activeElement === cancelBtn) {
                event.preventDefault();
                confirmBtn.focus();
            } else if (!event.shiftKey && document.activeElement === confirmBtn) {
                event.preventDefault();
                cancelBtn.focus();
            }
        };

        cancelBtn.onclick = () => finish(false);
        confirmBtn.onclick = () => finish(true);
        overlay.addEventListener('click', handleOverlayClick);
        document.addEventListener('keydown', handleKeydown);
        setTimeout(() => {
            if (!settled) cancelBtn.focus({ preventScroll: true });
        }, 0);
    });
}

function showCategoryDeleteConfirm(catName, scriptCount = 0) {
    const overlay = document.getElementById('uivCategoryDeleteConfirmOverlay');
    const dialog = overlay && overlay.querySelector('.uiv-delete-confirm-dialog');
    const nameEl = document.getElementById('uivCategoryDeleteConfirmName');
    const msgEl = document.getElementById('uivCategoryDeleteConfirmMessage');
    const cancelBtn = document.getElementById('uivCategoryDeleteConfirmCancel');
    const confirmBtn = document.getElementById('uivCategoryDeleteConfirmSubmit');
    if (!overlay || !dialog || !nameEl || !cancelBtn || !confirmBtn) {
        return Promise.resolve(false);
    }

    nameEl.textContent = scriptCount > 0 
        ? `${catName} （包含 ${scriptCount} 条脚本）` 
        : catName;
    if (msgEl) {
        msgEl.textContent = scriptCount > 0
            ? `注意：删除后该分类下的 ${scriptCount} 条脚本也将一并被彻底移除，无法恢复！`
            : `注意：该分类删除后将从智能调度仓库中移除，无法恢复。`;
    }
    const previousFocus = document.activeElement;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');

    return new Promise(resolve => {
        let settled = false;
        const finish = confirmed => {
            if (settled) return;
            settled = true;
            overlay.classList.remove('open');
            overlay.setAttribute('aria-hidden', 'true');
            overlay.removeEventListener('click', handleOverlayClick);
            document.removeEventListener('keydown', handleKeydown);
            cancelBtn.onclick = null;
            confirmBtn.onclick = null;
            if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
            resolve(confirmed);
        };
        const handleOverlayClick = event => {
            if (event.target === overlay) finish(false);
        };
        const handleKeydown = event => {
            if (event.key === 'Escape') finish(false);
            if (event.key !== 'Tab') return;
            if (event.shiftKey && document.activeElement === cancelBtn) {
                event.preventDefault();
                confirmBtn.focus();
            } else if (!event.shiftKey && document.activeElement === confirmBtn) {
                event.preventDefault();
                cancelBtn.focus();
            }
        };

        cancelBtn.onclick = () => finish(false);
        confirmBtn.onclick = () => finish(true);
        overlay.addEventListener('click', handleOverlayClick);
        document.addEventListener('keydown', handleKeydown);
        setTimeout(() => {
            if (!settled) cancelBtn.focus({ preventScroll: true });
        }, 0);
    });
}

function showCategoryCreateDialog() {
    const overlay = document.getElementById('uivCategoryCreateOverlay');
    const input = document.getElementById('uivCategoryCreateInput');
    const countEl = document.getElementById('uivCategoryCreateCount');
    const errorEl = document.getElementById('uivCategoryCreateError');
    const cancelBtn = document.getElementById('uivCategoryCreateCancel');
    const confirmBtn = document.getElementById('uivCategoryCreateSubmit');
    if (!overlay || !input || !countEl || !errorEl || !cancelBtn || !confirmBtn) {
        return Promise.resolve(null);
    }

    const maxLength = Number(input.maxLength) || 30;
    const previousFocus = document.activeElement;
    input.value = '';
    countEl.textContent = UIVT('uiv.categoryDialog.count', { count: 0, max: maxLength });
    errorEl.textContent = '';
    errorEl.classList.remove('visible');
    input.setAttribute('aria-invalid', 'false');
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');

    return new Promise(resolve => {
        let settled = false;
        const setError = message => {
            errorEl.textContent = message || '';
            errorEl.classList.toggle('visible', Boolean(message));
            input.setAttribute('aria-invalid', message ? 'true' : 'false');
        };
        const validate = () => {
            const name = input.value.trim();
            if (!name) {
                setError(UIVT('uiv.categoryDialog.required'));
                return null;
            }
            const duplicate = lastCategories.some(category =>
                String(category || '').trim().toLocaleLowerCase() === name.toLocaleLowerCase()
            );
            if (duplicate) {
                setError(UIVT('uiv.categoryDialog.duplicate'));
                return null;
            }
            setError('');
            return name;
        };
        const finish = name => {
            if (settled) return;
            settled = true;
            overlay.classList.remove('open');
            overlay.setAttribute('aria-hidden', 'true');
            overlay.removeEventListener('click', handleOverlayClick);
            document.removeEventListener('keydown', handleKeydown);
            input.removeEventListener('input', handleInput);
            cancelBtn.onclick = null;
            confirmBtn.onclick = null;
            if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
            resolve(name);
        };
        const submit = () => {
            const name = validate();
            if (name) finish(name);
            else input.focus({ preventScroll: true });
        };
        const handleInput = () => {
            countEl.textContent = UIVT('uiv.categoryDialog.count', {
                count: input.value.length,
                max: maxLength
            });
            if (errorEl.classList.contains('visible')) validate();
        };
        const handleOverlayClick = event => {
            if (event.target === overlay) finish(null);
        };
        const handleKeydown = event => {
            if (event.key === 'Escape') finish(null);
            if (event.key === 'Enter' && document.activeElement === input) {
                event.preventDefault();
                submit();
                return;
            }
            if (event.key !== 'Tab') return;
            if (event.shiftKey && document.activeElement === input) {
                event.preventDefault();
                confirmBtn.focus();
            } else if (!event.shiftKey && document.activeElement === confirmBtn) {
                event.preventDefault();
                input.focus();
            }
        };

        cancelBtn.onclick = () => finish(null);
        confirmBtn.onclick = submit;
        input.addEventListener('input', handleInput);
        overlay.addEventListener('click', handleOverlayClick);
        document.addEventListener('keydown', handleKeydown);
        setTimeout(() => {
            if (!settled) input.focus({ preventScroll: true });
        }, 0);
    });
}

function showScriptRenameDialog(script) {
    const overlay = document.getElementById('uivScriptRenameOverlay');
    const input = document.getElementById('uivScriptRenameInput');
    const countEl = document.getElementById('uivScriptRenameCount');
    const errorEl = document.getElementById('uivScriptRenameError');
    const cancelBtn = document.getElementById('uivScriptRenameCancel');
    const confirmBtn = document.getElementById('uivScriptRenameSubmit');

    if (!overlay || !input || !cancelBtn || !confirmBtn) {
        return AppDialog.prompt(UIVT('uiv.script.renamePrompt') || '请输入新的脚本名称：', { title: UIVT('uiv.dialog.renameTitle'), defaultValue: script?.name || '', maxLength: 100 })
            .then(promptResult => (promptResult ? promptResult.trim() : null));
    }

    const currentName = String(script?.name || '').trim();
    const maxLength = Number(input.maxLength) || 100;
    const previousFocus = document.activeElement;
    input.value = currentName;
    if (countEl) countEl.textContent = `${input.value.length}/${maxLength}`;
    if (errorEl) {
        errorEl.textContent = '';
        errorEl.classList.remove('visible');
    }
    input.setAttribute('aria-invalid', 'false');
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');

    return new Promise(resolve => {
        let settled = false;
        const setError = message => {
            if (errorEl) {
                errorEl.textContent = message || '';
                errorEl.classList.toggle('visible', Boolean(message));
            }
            input.setAttribute('aria-invalid', message ? 'true' : 'false');
        };
        const validate = () => {
            const name = input.value.trim();
            if (!name) {
                setError(UIVT('uiv.renameDialog.required') || '请先输入脚本名称');
                return null;
            }
            if (name === currentName) {
                return name;
            }
            const duplicate = (lastScripts || []).some(s =>
                s.id !== script.id &&
                String(s.name || '').trim().toLowerCase() === name.toLowerCase() &&
                s.category === script.category
            );
            if (duplicate) {
                setError(UIVT('uiv.renameDialog.duplicate') || '该分类下已存在同名脚本，请换一个名称');
                return null;
            }
            setError('');
            return name;
        };
        const finish = name => {
            if (settled) return;
            settled = true;
            overlay.classList.remove('open');
            overlay.setAttribute('aria-hidden', 'true');
            overlay.removeEventListener('click', handleOverlayClick);
            document.removeEventListener('keydown', handleKeydown);
            input.removeEventListener('input', handleInput);
            cancelBtn.onclick = null;
            confirmBtn.onclick = null;
            if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
            resolve(name);
        };
        const submit = () => {
            const name = validate();
            if (name) finish(name);
            else input.focus({ preventScroll: true });
        };
        const handleInput = () => {
            if (countEl) countEl.textContent = `${input.value.length}/${maxLength}`;
            if (errorEl && errorEl.classList.contains('visible')) validate();
        };
        const handleOverlayClick = event => {
            if (event.target === overlay) finish(null);
        };
        const handleKeydown = event => {
            if (event.key === 'Escape') finish(null);
            if (event.key === 'Enter' && document.activeElement === input) {
                event.preventDefault();
                submit();
                return;
            }
            if (event.key !== 'Tab') return;
            if (event.shiftKey && document.activeElement === input) {
                event.preventDefault();
                confirmBtn.focus();
            } else if (!event.shiftKey && document.activeElement === confirmBtn) {
                event.preventDefault();
                input.focus();
            }
        };

        cancelBtn.onclick = () => finish(null);
        confirmBtn.onclick = submit;
        input.addEventListener('input', handleInput);
        overlay.addEventListener('click', handleOverlayClick);
        document.addEventListener('keydown', handleKeydown);
        setTimeout(() => {
            if (!settled) {
                input.focus({ preventScroll: true });
                input.select();
            }
        }, 50);
    });
}

async function renameScript(script) {
    if (!script || !script.id) return;
    const newName = await showScriptRenameDialog(script);
    if (!newName || newName === script.name) return;

    try {
        const res = await API.patch(`/api/uiv/scripts/${encodeURIComponent(script.id)}/rename`, { name: newName });

        const updatedScript = res?.script || res?.item;

        const currentTitle = window.UIVWorkbench?.getCurrentTitle?.() || '';
        const baseOld = script.name.replace(/(_CN|_AE|_DE)$/, '');
        if (currentTitle === script.name || currentTitle === baseOld) {
            const baseNew = newName.replace(/(_CN|_AE|_DE)$/, '');
            window.UIVWorkbench?.setCurrentTitle?.(baseNew, baseNew);
            const fileNameInput = document.getElementById('fileName');
            if (fileNameInput && (fileNameInput.value === script.name || fileNameInput.value === baseOld)) {
                fileNameInput.value = baseNew;
            }
            const codeOutput = document.getElementById('codeOutput');
            const consoleOutput = document.getElementById('consoleOutput');
            if (codeOutput) {
                if (updatedScript?.code) {
                    codeOutput.value = updatedScript.code;
                } else if (window.UIVSave?.replaceGeneratedOutputFileName) {
                    codeOutput.value = window.UIVSave.replaceGeneratedOutputFileName(codeOutput.value, baseNew);
                }
            }
            if (consoleOutput) {
                if (updatedScript?.consoleCode) {
                    consoleOutput.value = updatedScript.consoleCode;
                } else if (window.UIVSave?.replaceGeneratedOutputFileName) {
                    consoleOutput.value = window.UIVSave.replaceGeneratedOutputFileName(consoleOutput.value, baseNew);
                }
            }
        }

        await loadSavedScripts({ reason: 'renameScript', scriptId: script.id, newName });
        const syncCount = res?.item?.ruleSyncCount ?? res?.script?.ruleSyncCount ?? 0;
        if (syncCount > 0) {
            showToast(UIVT('uiv.toast.scriptRenamedWithRules', { name: newName, count: syncCount }));
        } else {
            showToast(UIVT('uiv.toast.scriptRenamed', { name: newName }));
        }
        API.logHistory('uiv', '重命名脚本', `${script.name} -> ${newName}`);
    } catch (err) {
        logSidebarError('脚本重命名失败', err, { id: script.id, name: script.name });
        showToast(UIVT('uiv.toast.renameFail'), 'error');
    }
}

function renderRepositorySource() {
    const panel = document.getElementById('repoSourcePanel');
    if (!panel) return;
    panel.dataset.loaded = '1';

    const mode = API.getSourceMode('uiv_repository');
    const query = mode === 'auto' ? '' : `?mode=${encodeURIComponent(mode)}`;
    const meta = API.getLastDataSourceMeta(`/api/uiv/scripts${query}`) || API.getLastDataSourceMeta('/api/uiv/scripts') || {};
    const scriptSource = formatSourceLabel(meta.primary);
    const categorySource = formatSourceLabel(meta.extras ? meta.extras.categories : null);

    panel.innerHTML = `
        <span class="repo-source-badge">${UIVT('uiv.source.script', { source: scriptSource })}</span>
        <span class="repo-source-badge">${UIVT('uiv.source.category', { source: categorySource })}</span>
        <span class="repo-source-note">${UIVT('uiv.source.currentNote', { mode: formatSourceLabel(mode) })}</span>
    `;
}

// ──────────────────────────────────────────────────────────
// 数据加载
// ──────────────────────────────────────────────────────────
async function loadSavedScripts(options = {}) {
    try {
        const mode = API.getSourceMode('uiv_repository');
        const query = mode === 'auto' ? '' : `?mode=${encodeURIComponent(mode)}`;
        logSidebarStep('开始加载侧边栏脚本仓库', {
            mode,
            query: query || '(auto)',
            reason: options.reason || 'direct'
        });
        const { scripts, categories } = await API.get(`/api/uiv/scripts${query}`);
        lastScripts = scripts || [];
        lastCategories = categories || [];
        window.UIVUrlAssist?.setRepositoryScripts(lastScripts);
        logSidebarStep('脚本仓库接口返回成功', {
            scriptCount: scripts.length,
            categoryCount: categories.length,
            categoryBreakdown: categories.map(catName => ({
                category: catName,
                count: scripts.filter(s => s.category === catName).length
            }))
        });
        renderRepositorySource();
        renderSidebar(lastScripts, lastCategories);
        window.UIVSave?.syncCategorySelect?.(lastCategories);
        logSidebarStep('侧边栏渲染完成', {
            expandedCategories: [...expandedCategories]
        });
    } catch (e) {
        logSidebarError('加载侧边栏脚本仓库', e, {
            reason: options.reason || 'direct'
        });
        renderRepositorySource();
        showToast(UIVT('uiv.toast.serverFail'), 'error');
        throw e;
    }
}

// ──────────────────────────────────────────────────────────
// 渲染侧边栏
// ──────────────────────────────────────────────────────────
function renderSidebar(scripts, categories) {
    const list = document.getElementById('scriptList');
    list.innerHTML = '';

    categories.forEach(catName => {
        const catScripts = scripts.filter(s => s.category === catName);
        const isCustom = !DEFAULT_CATEGORIES.includes(catName);

        const groupDiv = document.createElement('div');
        groupDiv.className = 'category-group';
        if (expandedCategories.includes(catName)) groupDiv.classList.add('expanded');

        // 拖拽目标
        groupDiv.addEventListener('dragover', e => { e.preventDefault(); groupDiv.classList.add('drag-over'); });
        groupDiv.addEventListener('dragleave', () => groupDiv.classList.remove('drag-over'));
        groupDiv.addEventListener('drop', async e => {
            e.preventDefault();
            groupDiv.classList.remove('drag-over');
            if (draggedScriptId) {
                try {
                    await API.patch(`/api/uiv/scripts/${draggedScriptId}/category`, { category: catName });
                    if (!expandedCategories.includes(catName)) expandedCategories.push(catName);
                    await loadSavedScripts();
                } catch (err) {
                    showToast(UIVT('uiv.toast.moveFail'), 'error');
                }
            }
        });

        // 分类头
        const headerDiv = document.createElement('div');
        headerDiv.className = 'category-header';
        headerDiv.onclick = e => {
            if (e.target.tagName === 'BUTTON') return;
            groupDiv.classList.toggle('expanded');
            if (groupDiv.classList.contains('expanded')) {
                if (!expandedCategories.includes(catName)) expandedCategories.push(catName);
            } else {
                expandedCategories = expandedCategories.filter(c => c !== catName);
            }
        };

        const titleSpan = document.createElement('span');
        titleSpan.className = 'cat-title';
        titleSpan.innerHTML = `<span class="cat-arrow">▶</span> 📂 ${UIVI18n.categoryLabel(catName)} <span style="color:#aaa;font-weight:normal;">(${catScripts.length})</span>`;

        const actionSpan = document.createElement('div');
        actionSpan.className = 'category-actions';

        if (catScripts.length > 0) {
            const copyCatBtn = document.createElement('button');
            copyCatBtn.className = 'cat-copy-btn';
            copyCatBtn.innerHTML = '📦';
            copyCatBtn.title = UIVT('uiv.category.copyTitle');
            copyCatBtn.onclick = e => { e.stopPropagation(); window.UIVBatch.buildAndCopyMasterScript(catScripts, UIVI18n.categoryLabel(catName)); };
            actionSpan.appendChild(copyCatBtn);
        }

        if (isCustom) {
            const delCatBtn = document.createElement('button');
            delCatBtn.className = 'cat-del-btn';
            delCatBtn.innerHTML = '✖';
            delCatBtn.title = UIVT('uiv.category.deleteTitle');
            delCatBtn.onclick = e => { e.stopPropagation(); deleteCategory(catName); };
            actionSpan.appendChild(delCatBtn);
        }

        headerDiv.appendChild(titleSpan);
        headerDiv.appendChild(actionSpan);
        groupDiv.appendChild(headerDiv);

        // 分类内容
        const contentDiv = document.createElement('div');
        contentDiv.className = 'category-content';

        if (catScripts.length === 0) {
            contentDiv.innerHTML = `<div style="color:#666;font-size:11px;text-align:center;padding:5px;">${UIVT('uiv.category.empty')}</div>`;
        }

        catScripts.forEach(script => {
            const item = buildScriptItem(script);
            contentDiv.appendChild(item);
        });

        groupDiv.appendChild(contentDiv);
        list.appendChild(groupDiv);
    });
}

// ──────────────────────────────────────────────────────────
// 构建单个脚本条目
// ──────────────────────────────────────────────────────────
function buildScriptItem(script) {
    const item = document.createElement('div');
    item.className = 'script-item';
    item.draggable = true;
    item.title = UIVT('uiv.script.itemTitle');

    item.addEventListener('dragstart', e => {
        draggedScriptId = script.id;
        setTimeout(() => item.style.opacity = '0.5', 0);
    });
    item.addEventListener('dragend', () => {
        draggedScriptId = null;
        item.style.opacity = '1';
    });

    item.addEventListener('dblclick', e => {
        if (e.target.tagName === 'BUTTON') return;
        window.UIVWorkbench.fillWorkbench(script);
        const orig = item.style.backgroundColor;
        item.style.backgroundColor = '#2e7d32';
        setTimeout(() => item.style.backgroundColor = orig, 300);
        showToast(UIVT('uiv.toast.filled', { name: script.name }));
    });

    const itemTitle = document.createElement('div');
    itemTitle.className = 'script-item-title';
    itemTitle.innerText = '📄 ' + script.name;
    itemTitle.title = script.name;

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'sidebar-actions';

    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display:flex;gap:5px;';

    const uivBtn = document.createElement('button');
    uivBtn.className = 'mini-btn uiv';
    uivBtn.innerText = 'UIV';
    uivBtn.onclick = () => window.UIVCopy.copyFromMemory(script.code, 'UI.Vision');

    const conBtn = document.createElement('button');
    conBtn.className = 'mini-btn con';
    conBtn.innerText = 'F12';
    conBtn.onclick = () => {
        if (script.consoleCode) window.UIVCopy.copyFromMemory(script.consoleCode, UIVT('uiv.copy.consoleScript'));
        else AppDialog.alert(UIVT('uiv.alert.legacyScript'), { title: UIVT('uiv.dialog.notice'), tone: 'warning' });
    };

    const rightActions = document.createElement('div');
    rightActions.style.cssText = 'display:flex;gap:4px;align-items:center;';

    const renBtn = document.createElement('button');
    renBtn.className = 'mini-btn ren';
    renBtn.type = 'button';
    renBtn.innerText = '✏️';
    renBtn.title = UIVT('uiv.script.renameTitle', { name: script.name });
    renBtn.setAttribute('aria-label', renBtn.title);
    renBtn.draggable = false;
    renBtn.addEventListener('mousedown', event => event.stopPropagation());
    renBtn.onclick = async event => {
        event.stopPropagation();
        await renameScript(script);
    };

    const delBtn = document.createElement('button');
    delBtn.className = 'mini-btn del';
    delBtn.type = 'button';
    delBtn.innerText = `🗑 ${UIVT('uiv.script.deleteAction')}`;
    delBtn.title = UIVT('uiv.script.deleteTitle', { name: script.name });
    delBtn.setAttribute('aria-label', delBtn.title);
    delBtn.draggable = false;
    delBtn.addEventListener('mousedown', event => event.stopPropagation());
    delBtn.onclick = async event => {
        event.stopPropagation();
        const confirmed = await showScriptDeleteConfirm(script.name);
        if (!confirmed) return;
        try {
            await API.delete(`/api/uiv/scripts/${script.id}`);
            await loadSavedScripts();
            showToast(UIVT('uiv.toast.scriptDeleted'));
            API.logHistory('uiv', '删除脚本', script.name);
        } catch (err) {
            showToast(UIVT('uiv.toast.deleteFail'), 'error');
        }
    };

    btnGroup.appendChild(uivBtn);
    btnGroup.appendChild(conBtn);
    rightActions.appendChild(renBtn);
    rightActions.appendChild(delBtn);
    actionsDiv.appendChild(btnGroup);
    actionsDiv.appendChild(rightActions);
    item.appendChild(itemTitle);
    item.appendChild(actionsDiv);
    return item;
}

// ──────────────────────────────────────────────────────────
// 分类操作
// ──────────────────────────────────────────────────────────
async function createNewCategory() {
    const newCat = await showCategoryCreateDialog();
    if (!newCat) return;
    try {
        await API.post('/api/uiv/categories', { name: newCat });
        if (!expandedCategories.includes(newCat)) expandedCategories.push(newCat);
        await loadSavedScripts();
        showToast(UIVT('uiv.toast.categoryCreated'));
    } catch (e) {
        showToast(UIVT('uiv.toast.createFail'), 'error');
    }
}

async function deleteCategory(catName) {
    const scriptsInCat = (lastScripts || []).filter(s => (s.category || '默认分类') === catName);
    const confirmed = await showCategoryDeleteConfirm(UIVI18n.categoryLabel(catName), scriptsInCat.length);
    if (!confirmed) return;
    try {
        await API.delete(`/api/uiv/categories/${encodeURIComponent(catName)}`);
        expandedCategories = expandedCategories.filter(c => c !== catName);
        await loadSavedScripts();
        showToast(UIVT('uiv.toast.categoryDeleted'));
    } catch (e) {
        showToast(UIVT('uiv.toast.deleteFail'), 'error');
    }
}

// ──────────────────────────────────────────────────────────
// 导入 / 导出
// ──────────────────────────────────────────────────────────
async function exportBackup() {
    try {
        const data = await API.get('/api/uiv/backup');
        if (data.scripts.length === 0 && (!data.categories || data.categories.length === 0)) {
            showToast(UIVT('uiv.alert.emptyExport'), 'warning'); return;
        }
        const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = UIVT('uiv.export.filename', { date: dateStr });
        a.click();
        showToast(UIVT('uiv.toast.exported'));
        API.logHistory('uiv', '导出脚本', `共 ${data.scripts.length} 个脚本`);
    } catch (e) {
        showToast(UIVT('uiv.toast.exportFail'), 'error');
    }
}

async function importBackup(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async e => {
        try {
            const parsed = JSON.parse(e.target.result);
            if (!Array.isArray(parsed.scripts)) { AppDialog.alert(UIVT('uiv.alert.invalidBackup'), { title: UIVT('uiv.dialog.error'), tone: 'error' }); return; }
            // 原生 confirm 的「取消」代表覆盖导入；统一弹窗中关闭/Esc 也会返回 false，所以覆盖前再做一次危险确认，避免误清空仓库
            const merge = await AppDialog.confirm(UIVT('uiv.confirm.importMode'), { title: UIVT('uiv.dialog.importTitle'), tone: 'info', confirmText: UIVT('uiv.dialog.merge'), cancelText: UIVT('uiv.dialog.overwrite') });
            if (!merge && !await AppDialog.confirm(UIVT('uiv.confirm.importOverwrite'), { title: UIVT('uiv.dialog.overwriteTitle'), tone: 'danger', confirmText: UIVT('uiv.dialog.overwrite'), cancelText: UIVT('uiv.dialog.cancel') })) { event.target.value = ''; return; }
            await API.post('/api/uiv/backup', { scripts: parsed.scripts, categories: parsed.categories, merge });
            await loadSavedScripts();
            showToast(UIVT('uiv.toast.imported'));
            API.logHistory('uiv', merge ? '融合导入' : '覆盖导入', `共 ${parsed.scripts.length} 个脚本`);
        } catch (err) {
            AppDialog.alert(UIVT('uiv.alert.importFail'), { title: UIVT('uiv.dialog.error'), tone: 'error' });
        }
        event.target.value = '';
    };
    reader.readAsText(file);
}

// 暴露给全局
function refreshI18n() {
    renderRepositorySource();
    if (lastCategories.length) renderSidebar(lastScripts, lastCategories);
}

function getScripts() {
    return Array.isArray(lastScripts) ? [...lastScripts] : [];
}

function getCategories() {
    return Array.isArray(lastCategories) ? [...lastCategories] : [];
}

function refillScript(scriptId) {
    const script = lastScripts.find(item => item.id === scriptId);
    if (!script) return false;
    window.UIVWorkbench.fillWorkbench(script);
    showToast(UIVT('uiv.toast.filled', { name: script.name }));
    return true;
}

window.UIVSidebar = {
    loadSavedScripts,
    createNewCategory,
    exportBackup,
    importBackup,
    refreshI18n,
    getScripts,
    getCategories,
    refillScript,
    renameScript,
    showScriptRenameDialog
};
