/**
 * uivf12/save.js - 脚本保存模块
 * 负责：当前工作台生成结果保存到服务端脚本仓库（支持 NetCare 三区阵列）
 */

function getScriptPayloadBytes(item) {
    try {
        return new Blob([JSON.stringify(item)]).size;
    } catch (e) {
        return 0;
    }
}

function isCompressionSupported() {
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

async function buildCompressedSaveBody(items, algorithm = 'gzip') {
    const compressedItems = [];

    for (const item of items) {
        const compressedFields = {
            code: await compressTextToTransportField(item.code || '', algorithm),
            consoleCode: await compressTextToTransportField(item.consoleCode || '', algorithm),
            payload: await compressTextToTransportField(item.payload || '', algorithm)
        };

        compressedItems.push({
            ...item,
            code: undefined,
            consoleCode: undefined,
            payload: undefined,
            compressedFields
        });
    }

    const sanitizedItems = compressedItems.map(item => {
        const next = { ...item };
        delete next.code;
        delete next.consoleCode;
        delete next.payload;
        return next;
    });

    return {
        transport: {
            compression: `${algorithm}+base64`,
            itemCount: sanitizedItems.length
        },
        items: sanitizedItems
    };
}

function summarizeCompressedItems(body) {
    const items = Array.isArray(body && body.items) ? body.items : [];
    return items.map(item => ({
        name: item.name,
        category: item.category,
        codeBytes: item.compressedFields && item.compressedFields.code ? `${item.compressedFields.code.originalBytes} -> ${item.compressedFields.code.compressedBytes}` : '-',
        consoleBytes: item.compressedFields && item.compressedFields.consoleCode ? `${item.compressedFields.consoleCode.originalBytes} -> ${item.compressedFields.consoleCode.compressedBytes}` : '-',
        payloadBytes: item.compressedFields && item.compressedFields.payload ? `${item.compressedFields.payload.originalBytes} -> ${item.compressedFields.payload.compressedBytes}` : '-'
    }));
}

function logSaveStep(step, detail) {
    const prefix = '%c[UIVF12 Save]';
    const style = 'color:#22c55e;font-weight:700;';
    if (detail === undefined) {
        console.info(prefix, style, step);
        return;
    }
    console.info(prefix, style, step, detail);
}

function logSaveError(step, error, detail) {
    const prefix = '%c[UIVF12 Save]';
    const style = 'color:#ef4444;font-weight:700;';
    console.error(prefix, style, `${step} failed`, detail || '', error);
}

function rebaseSaveItemNames(items, oldBaseName, newBaseName) {
    const oldBase = String(oldBaseName || '');
    const nextBase = String(newBaseName || '').trim();
    if (!nextBase) return items;
    return items.map(item => {
        const currentName = String(item.name || '');
        const suffix = oldBase && currentName.startsWith(oldBase)
            ? currentName.slice(oldBase.length)
            : '';
        return {
            ...item,
            name: nextBase + suffix,
            originalFileName: nextBase
        };
    });
}

function buildRenamedOutputFileName(baseName) {
    const normalized = String(baseName || '').trim().replace(/\.csv$/i, '');
    if (!normalized) return '';
    return /_Latest$/i.test(normalized) ? `${normalized}.csv` : `${normalized}_Latest.csv`;
}

function replaceGeneratedOutputFileName(code, baseName) {
    const outputFileName = buildRenamedOutputFileName(baseName);
    if (!outputFileName || typeof code !== 'string') return code;
    return code.replace(
        /((?:let|const|var)\s+finalOutputName\s*=\s*)("(?:\\.|[^"\\])*")/g,
        (match, assignment) => `${assignment}${JSON.stringify(outputFileName)}`
    );
}

function syncGeneratedOutputFileName() {
    const input = document.getElementById('fileName');
    const codeOutput = document.getElementById('codeOutput');
    const consoleOutput = document.getElementById('consoleOutput');
    const baseName = input?.value.trim() || '';
    if (!baseName || !codeOutput?.value || !consoleOutput?.value) return false;
    codeOutput.value = replaceGeneratedOutputFileName(codeOutput.value, baseName);
    consoleOutput.value = replaceGeneratedOutputFileName(consoleOutput.value, baseName);
    return true;
}

const PREFERRED_CATEGORY_STORAGE_KEY = 'uiv_preferred_save_category';

function getPreferredSaveCategory() {
    try {
        return localStorage.getItem(PREFERRED_CATEGORY_STORAGE_KEY) || '';
    } catch (_) {
        return '';
    }
}

function setPreferredSaveCategory(category) {
    try {
        if (category) {
            localStorage.setItem(PREFERRED_CATEGORY_STORAGE_KEY, category);
        } else {
            localStorage.removeItem(PREFERRED_CATEGORY_STORAGE_KEY);
        }
    } catch (_) {}
}

function onCategorySelectChange(value) {
    setPreferredSaveCategory(value);
    logSaveStep('已更新记忆的脚本保存分类', { category: value || '(自动判断)' });
}

function syncCategorySelect(categories = []) {
    const select = document.getElementById('saveCategorySelect');
    if (!select) return;

    const savedValue = getPreferredSaveCategory();
    const currentVal = select.value || savedValue;

    const allCategories = [];
    const pushCat = (cat) => {
        const c = String(cat || '').trim();
        if (c && !allCategories.includes(c)) allCategories.push(c);
    };

    const defaultCats = ['DataFab', 'NetCare中国', 'NetCare中东', 'NetCare德国', '默认分类'];
    defaultCats.forEach(pushCat);
    (Array.isArray(categories) ? categories : []).forEach(pushCat);

    const autoLabel = typeof window.UIVT === 'function' ? window.UIVT('uiv.save.autoCategory') : '📂 自动判断分类';
    select.innerHTML = `<option value="">${autoLabel}</option>`;

    allCategories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        const displayLabel = window.UIVI18n ? window.UIVI18n.categoryLabel(cat) : cat;
        opt.textContent = `📁 ${displayLabel}`;
        select.appendChild(opt);
    });

    if (currentVal && allCategories.includes(currentVal)) {
        select.value = currentVal;
    } else if (savedValue && allCategories.includes(savedValue)) {
        select.value = savedValue;
    } else {
        select.value = '';
    }
}

function findNameConflicts(items, existingScripts) {
    return items.filter(item => existingScripts.some(s => s.name === item.name));
}

async function saveCurrentScript() {
    let codeUIV = document.getElementById('codeOutput').value;
    let codeConsole = document.getElementById('consoleOutput').value;
    const url = document.getElementById('requestUrl').value.trim();
    if (!codeUIV || !codeConsole) { alert(UIVT('uiv.save.needGenerate')); return; }

    // 不管 AI 命名当前处于何种状态（分析中、生成中或就绪），都支持立即保存当前脚本，不阻断保存流程
    window.UIVAINaming?.markSaved?.();

    logSaveStep('开始保存脚本到侧边栏', {
        url,
        codeUIVBytes: new Blob([codeUIV]).size,
        codeConsoleBytes: new Blob([codeConsole]).size
    });

    const parsedPayloadObj = window.UIVWorkbench.getParsedPayload();
    const rawJson = parsedPayloadObj ? JSON.stringify(parsedPayloadObj, null, 4) : document.getElementById('jsonInput').value.trim();
    const originalFileName = document.getElementById('fileName').value.trim() || UIVT('uiv.save.defaultFile');
    const responseSample = document.getElementById('responseSampleInput')?.value.trim() || '';
    const responseFocusKeyword = document.getElementById('responseFocusKeyword')?.value.trim() || '';
    const responseFocusPath = document.getElementById('responseFocusPath')?.value.trim() || '';
    const responseFocusConfig = window.UIVWorkbench?.getResponseFocusConfig?.() || null;
    const configOptions = {
        useGlobalVars: document.getElementById('useGlobalVars').checked,
        isPagination: document.getElementById('isPagination').checked,
        forceSumData: document.getElementById('forceSumData').checked,
        autoFetchCPC: document.getElementById('autoFetchCPC').checked,
        autoRuntimeMonth: document.getElementById('autoRuntimeMonth').checked,
        autoNetCareTriplicate: document.getElementById('autoNetCareTriplicate') ? document.getElementById('autoNetCareTriplicate').checked : false,
        responseSample,
        responseFocusKeyword,
        responseFocusPath,
        responseFocusConfig
    };

    const baseName = window.UIVWorkbench.getCurrentTitle() || originalFileName;
    const generatedInputName = typeof window.UIVWorkbench.getCurrentTitleInputName === 'function'
        ? window.UIVWorkbench.getCurrentTitleInputName()
        : '';
    const hasUserTypedNewName = Boolean(originalFileName && originalFileName !== baseName && originalFileName !== generatedInputName);
    const aiAdapterMeta = window.__uivAiAdapterCurrent && typeof window.__uivAiAdapterCurrent === 'object'
        ? window.__uivAiAdapterCurrent
        : {};
    const isNetCare = url.toLowerCase().includes('netcare');
    let itemsToSave = [];

    // 快捷下拉分类判断：如果用户选择了分类，使用用户指定的分类；默认空则由原有逻辑自动判断
    const selectEl = document.getElementById('saveCategorySelect');
    const chosenCategory = ((selectEl ? selectEl.value : getPreferredSaveCategory()) || '').trim();

    if (chosenCategory) {
        itemsToSave.push({
            name: baseName,
            code: codeUIV,
            consoleCode: codeConsole,
            category: chosenCategory,
            url,
            payload: rawJson,
            originalFileName,
            configOptions,
            responseSample,
            responseFocusKeyword,
            responseFocusPath,
            responseFocusConfig
        });
    } else if (isNetCare && configOptions.autoNetCareTriplicate) {
        let urlObj;
        try { urlObj = new URL(url); } catch (e) {}
        if (urlObj && urlObj.pathname) {
            const path = urlObj.pathname + urlObj.search;
            const regions = [
                { cat: 'NetCare中国', domain: 'https://netcare.huawei.com',    suffix: '-CN' },
                { cat: 'NetCare中东', domain: 'https://netcare-ae.gts.huawei.com', suffix: '-AE' },
                { cat: 'NetCare德国', domain: 'https://netcare-de.gts.huawei.com', suffix: '-DE' }
            ];
            regions.forEach(r => {
                const newUrl = r.domain + path;
                itemsToSave.push({
                    name: baseName + r.suffix,
                    code: codeUIV.split(url).join(newUrl),
                    consoleCode: codeConsole.split(url).join(newUrl),
                    category: r.cat, url: newUrl,
                    payload: rawJson, originalFileName, configOptions,
                    responseSample, responseFocusKeyword, responseFocusPath, responseFocusConfig
                });
            });
        } else {
            itemsToSave.push({ name: baseName, code: codeUIV, consoleCode: codeConsole, category: window.UIVWorkbench.autoDetectCategory(url), url, payload: rawJson, originalFileName, configOptions, responseSample, responseFocusKeyword, responseFocusPath, responseFocusConfig });
        }
    } else {
        itemsToSave.push({ name: baseName, code: codeUIV, consoleCode: codeConsole, category: window.UIVWorkbench.autoDetectCategory(url), url, payload: rawJson, originalFileName, configOptions, responseSample, responseFocusKeyword, responseFocusPath, responseFocusConfig });
    }
    itemsToSave = itemsToSave.map(item => ({ ...item, ...aiAdapterMeta }));

    if (hasUserTypedNewName) {
        itemsToSave = rebaseSaveItemNames(itemsToSave, baseName, originalFileName).map(item => ({
            ...item,
            code: replaceGeneratedOutputFileName(item.code, originalFileName),
            consoleCode: replaceGeneratedOutputFileName(item.consoleCode, originalFileName)
        }));
        document.getElementById('codeOutput').value = replaceGeneratedOutputFileName(codeUIV, originalFileName);
        document.getElementById('consoleOutput').value = replaceGeneratedOutputFileName(codeConsole, originalFileName);
        window.UIVWorkbench.setCurrentTitle(originalFileName, originalFileName);
        logSaveStep('已采用生成后输入的新名称', {
            generatedTitle: baseName,
            generatedInputName,
            inputName: originalFileName,
            savedNames: itemsToSave.map(item => item.name),
            outputFileName: buildRenamedOutputFileName(originalFileName)
        });
    }

    logSaveStep('已生成待保存脚本对象', {
        count: itemsToSave.length,
        items: itemsToSave.map(item => ({
            name: item.name,
            category: item.category,
            url: item.url,
            bytes: getScriptPayloadBytes(item)
        }))
    });

    // 冲突检查
    let existingScripts = [];
    try {
        logSaveStep('开始执行重名冲突检查');
        const resp = await API.get('/api/uiv/scripts');
        existingScripts = resp.scripts || [];
        logSaveStep('重名冲突检查所需仓库已加载', {
            existingScriptCount: existingScripts.length
        });
    } catch (error) {
        logSaveError('加载现有脚本仓库', error);
        throw error;
    }

    let conflicts = findNameConflicts(itemsToSave, existingScripts);
    logSaveStep('冲突检查结果', {
        conflictCount: conflicts.length,
        conflictNames: conflicts.map(item => item.name)
    });

    if (conflicts.length > 0) {
        const msg = conflicts.length > 1
            ? UIVT('uiv.save.conflictMany', { count: conflicts.length })
            : UIVT('uiv.save.conflictOne', { name: conflicts[0].name });
        if (!confirm(msg)) return;
    }

    try {
        logSaveStep('开始提交保存请求', {
            requestBytes: new Blob([JSON.stringify({ items: itemsToSave })]).size
        });
        const saveResult = await API.post('/api/uiv/scripts', { items: itemsToSave });
        logSaveStep('保存请求完成', saveResult);

        logSaveStep('开始刷新侧边栏脚本仓库');
        await window.UIVSidebar.loadSavedScripts({ reason: 'saveCurrentScript', savedItems: itemsToSave.map(i => i.name) });
        logSaveStep('侧边栏刷新完成', {
            savedNames: itemsToSave.map(i => i.name)
        });

        showToast(itemsToSave.length > 1 ? UIVT('uiv.save.toastTriplicate', { count: itemsToSave.length }) : UIVT('uiv.save.toastSaved'));
        API.logHistory('uiv', '保存脚本', itemsToSave.map(i => i.name).join(', '));
        logSaveStep('历史记录已异步触发', {
            names: itemsToSave.map(i => i.name)
        });

        const btn = document.getElementById('saveBtn');
        const oldText = btn.innerText;
        btn.innerText = itemsToSave.length > 1 ? UIVT('uiv.save.btnTriplicate') : UIVT('uiv.save.btnSaved');
        setTimeout(() => btn.innerText = oldText, 2000);
    } catch (e) {
        logSaveError('普通保存链路', e, {
            names: itemsToSave.map(i => i.name)
        });

        if (!isCompressionSupported()) {
            showToast(UIVT('uiv.save.noCompression'), 'error');
            return;
        }

        try {
            logSaveStep('普通保存失败，开始构建 gzip 压缩重试请求');
            const compressedBody = await buildCompressedSaveBody(itemsToSave, 'gzip');
            logSaveStep('gzip 压缩请求已构建', {
                requestBytes: new Blob([JSON.stringify(compressedBody)]).size,
                items: summarizeCompressedItems(compressedBody)
            });

            const retryResult = await API.post('/api/uiv/scripts', compressedBody);
            logSaveStep('gzip 压缩重试成功', retryResult);

            logSaveStep('开始刷新侧边栏脚本仓库', {
                reason: 'saveCurrentScript-compressed-retry'
            });
            await window.UIVSidebar.loadSavedScripts({ reason: 'saveCurrentScript-compressed-retry', savedItems: itemsToSave.map(i => i.name) });
            logSaveStep('压缩重试后的侧边栏刷新完成', {
                savedNames: itemsToSave.map(i => i.name)
            });

            showToast(itemsToSave.length > 1 ? UIVT('uiv.save.retryTriplicate', { count: itemsToSave.length }) : UIVT('uiv.save.retrySaved'));
            API.logHistory('uiv', '保存脚本(压缩重试)', itemsToSave.map(i => i.name).join(', '));
        } catch (retryError) {
            logSaveError('gzip 压缩重试链路', retryError, {
                names: itemsToSave.map(i => i.name)
            });
            showToast(UIVT('uiv.save.retryFail'), 'error');
        }
    }
}

document.getElementById('fileName')?.addEventListener('input', syncGeneratedOutputFileName);
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => syncCategorySelect());
    } else {
        syncCategorySelect();
    }
}

window.UIVSave = {
    saveCurrentScript,
    syncGeneratedOutputFileName,
    onCategorySelectChange,
    syncCategorySelect,
    getPreferredSaveCategory,
    setPreferredSaveCategory
};
