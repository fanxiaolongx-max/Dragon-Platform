/**
 * uivf12/analysis.js - 脚本仓库分析弹窗
 * 从保存的脚本元数据中提取请求、筛选字段、运行开关和响应取表逻辑。
 */
(function () {
    let analyzedRows = [];
    let rawScripts = [];
    const modifiedRows = new Map();
    const expandedFilterRows = new Set();
    let activeDialog = null;
    let highlightedScriptId = '';
    const SAVE_AS_CATEGORY_KEY = 'uiv_script_analysis_last_category';

    function text(value, fallback = '-') {
        if (value === null || value === undefined || value === '') return fallback;
        return String(value);
    }

    function safeJsonParse(raw) {
        if (!raw || typeof raw !== 'string') return null;
        try {
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    function cloneJson(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function extractBalancedObject(raw, startIndex) {
        const firstBrace = raw.indexOf('{', startIndex);
        if (firstBrace < 0) return '';
        let depth = 0;
        let inString = false;
        let quote = '';
        let escaped = false;
        for (let i = firstBrace; i < raw.length; i++) {
            const ch = raw[i];
            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (ch === '\\') {
                    escaped = true;
                } else if (ch === quote) {
                    inString = false;
                    quote = '';
                }
                continue;
            }
            if (ch === '"' || ch === "'") {
                inString = true;
                quote = ch;
                continue;
            }
            if (ch === '{') depth++;
            if (ch === '}') {
                depth--;
                if (depth === 0) return raw.slice(firstBrace, i + 1);
            }
        }
        return '';
    }

    function findBalancedObjectRange(raw, startIndex) {
        const firstBrace = raw.indexOf('{', startIndex);
        if (firstBrace < 0) return null;
        let depth = 0;
        let inString = false;
        let quote = '';
        let escaped = false;
        for (let i = firstBrace; i < raw.length; i++) {
            const ch = raw[i];
            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (ch === '\\') {
                    escaped = true;
                } else if (ch === quote) {
                    inString = false;
                    quote = '';
                }
                continue;
            }
            if (ch === '"' || ch === "'") {
                inString = true;
                quote = ch;
                continue;
            }
            if (ch === '{') depth++;
            if (ch === '}') {
                depth--;
                if (depth === 0) return { start: firstBrace, end: i + 1 };
            }
        }
        return null;
    }

    function parsePayloadFromCode(code) {
        const raw = typeof code === 'string' ? code : '';
        const markerIndex = raw.indexOf('baseDetailPayload');
        if (markerIndex < 0) return null;
        const objectText = extractBalancedObject(raw, markerIndex);
        if (!objectText) return null;
        const normalized = objectText
            .replace(/\btargetRegion\b/g, '"北部非洲地区部"')
            .replace(/\btargetOffice\b/g, '"埃及代表处"')
            .replace(/\btargetDate\b/g, '"2026-01-01"')
            .replace(/\bcpcIds\b/g, '["__DYNAMIC_CPC__"]')
            .replace(/\bfetchedNids\b/g, '["__DYNAMIC_NID__"]')
            .replace(/,\s*([}\]])/g, '$1');
        return safeJsonParse(normalized);
    }

    function stringifyPayloadForCode(payload) {
        return JSON.stringify(payload, null, 10);
    }

    function replaceBasePayloadInCode(code, payload, row) {
        if (!code || typeof code !== 'string' || !payload) return code || '';
        const markerIndex = code.indexOf('baseDetailPayload');
        if (markerIndex < 0) return code;
        const range = findBalancedObjectRange(code, markerIndex);
        if (!range) return code;

        let payloadClone = cloneJson(payload);
        const config = row ? (row.script.configOptions || row.configOptions) : {};
        const platform = row ? row.platform : '';

        let hasCPC = false;
        function traversePayload(obj) {
            if (typeof obj !== 'object' || obj === null) return;
            if (platform === 'DataFab' && config.autoFetchCPC && obj.column === 'cpc' && Array.isArray(obj.values)) {
                hasCPC = true; obj.values = '__CPC_IDS_PLACEHOLDER__';
            }
            if (platform === 'NetCare' && config.autoFetchCPC) {
                if (obj.nid !== undefined && Array.isArray(obj.nid)) { obj.nid = '__NID_PLACEHOLDER__'; }
                if (obj.nid_name !== undefined && Array.isArray(obj.nid_name)) { obj.nid_name = '__NID_PLACEHOLDER__'; }
            }
            if (config.autoRuntimeMonth) {
                if (typeof obj.column === 'string' && Array.isArray(obj.values) && obj.values.length === 1 && typeof obj.values[0] === 'string') {
                    if (obj.column.toLowerCase().includes('month') && /^[0-9]{1,2}$/.test(obj.values[0])) {
                        obj.values = '__MONTH_PLACEHOLDER__';
                    }
                    if (obj.column.toLowerCase().includes('year') && /^[0-9]{4}$/.test(obj.values[0])) {
                        obj.values = '__YEAR_PLACEHOLDER__';
                    }
                }
                let sKey = Object.keys(obj).find(k => (k.toLowerCase().includes('start_date') || k.toLowerCase() === 'startdate') && typeof obj[k] === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(obj[k]));
                let eKey = Object.keys(obj).find(k => (k.toLowerCase().includes('end_date') || k.toLowerCase() === 'enddate') && typeof obj[k] === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(obj[k]));
                if (sKey && eKey) {
                    const sMonth = obj[sKey].substring(0, 7), eMonth = obj[eKey].substring(0, 7);
                    if (sMonth === eMonth) {
                        obj[sKey] = '__START_DATE_PLACEHOLDER__' + obj[sKey].substring(10);
                        obj[eKey] = '__END_DATE_PLACEHOLDER__' + obj[eKey].substring(10);
                    }
                }
            }
            for (let key in obj) { traversePayload(obj[key]); }
        }
        traversePayload(payloadClone);

        let paramsStr = stringifyPayloadForCode(payloadClone);
        if (config.useGlobalVars) {
            paramsStr = paramsStr.replace(/"北部非洲地区部"/g, 'targetRegion').replace(/"埃及代表处"/g, 'targetOffice');
        }
        if (hasCPC) {
            paramsStr = paramsStr.replace(/"__CPC_IDS_PLACEHOLDER__"/g, 'cpcIds');
        }

        return code.slice(0, range.start) + paramsStr + code.slice(range.end);
    }

    function parseEditedValue(rawValue) {
        if (Array.isArray(rawValue)) return rawValue.map(item => String(item).trim()).filter(Boolean);
        const trimmed = String(rawValue || '').trim();
        if (!trimmed) return [];
        if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
            const parsed = safeJsonParse(trimmed);
            if (parsed !== null) return parsed;
        }
        if (trimmed.includes(',')) {
            return trimmed.split(',').map(item => item.trim()).filter(Boolean);
        }
        return trimmed;
    }

    function getValueSeparator(value) {
        if (Array.isArray(value)) return '';
        const raw = String(value || '');
        if (raw.includes(';')) return ';';
        if (raw.includes(',')) return ',';
        return '';
    }

    function splitMultiString(value, separator) {
        const raw = String(value || '').trim();
        if (!raw) return [''];
        if (!separator) return [raw];
        return raw.split(separator).map(item => item.trim()).filter(Boolean);
    }

    function normalizeMultiValues(value, separator = '') {
        if (Array.isArray(value)) return value.map(item => String(item)).filter(Boolean);
        const raw = String(value || '').trim();
        if (!raw) return [''];
        if (separator) return splitMultiString(raw, separator);
        if (raw.includes(';')) return splitMultiString(raw, ';');
        if (raw.includes(',')) return splitMultiString(raw, ',');
        return [raw];
    }

    function renderMultiValueRows(values) {
        const editor = document.getElementById('scriptAnalysisMultiEditor');
        if (!editor) return;
        const rows = values.length ? values : [''];
        editor.innerHTML = rows.map(value => `
            <div class="script-analysis-multi-row">
                <input type="text" value="${escapeHtml(value)}" placeholder="输入一个值">
                <button class="script-analysis-multi-del" onclick="UIVScriptAnalysis.removeMultiValue(this)" type="button">×</button>
            </div>
        `).join('');
    }

    function getMultiValueRows() {
        return [...document.querySelectorAll('#scriptAnalysisMultiEditor input')]
            .map(input => input.value.trim())
            .filter(Boolean);
    }

    function addMultiValue() {
        const values = getMultiValueRows();
        values.push('');
        renderMultiValueRows(values);
        const inputs = document.querySelectorAll('#scriptAnalysisMultiEditor input');
        const last = inputs[inputs.length - 1];
        if (last) last.focus();
    }

    function removeMultiValue(button) {
        const row = button.closest('.script-analysis-multi-row');
        if (row) row.remove();
        const editor = document.getElementById('scriptAnalysisMultiEditor');
        if (editor && editor.querySelectorAll('input').length === 0) renderMultiValueRows(['']);
    }

    function openMiniDialog({ title, message, input = false, value = '', confirmText = '确认', danger = false, saveAs = null, multiValues = null }) {
        const overlay = document.getElementById('scriptAnalysisMiniDialog');
        const titleEl = document.getElementById('scriptAnalysisMiniTitle');
        const messageEl = document.getElementById('scriptAnalysisMiniMessage');
        const inputEl = document.getElementById('scriptAnalysisMiniInput');
        const confirmBtn = document.getElementById('scriptAnalysisMiniConfirm');
        const multiEditor = document.getElementById('scriptAnalysisMultiEditor');
        const multiAdd = document.getElementById('scriptAnalysisMultiAdd');
        const saveAsFields = document.getElementById('scriptAnalysisSaveAsFields');
        const saveAsName = document.getElementById('scriptAnalysisSaveAsName');
        const saveAsCategory = document.getElementById('scriptAnalysisSaveAsCategory');
        if (!overlay || !titleEl || !messageEl || !inputEl || !confirmBtn || !multiEditor || !multiAdd || !saveAsFields || !saveAsName || !saveAsCategory) {
            return Promise.resolve(null);
        }

        const isMulti = Array.isArray(multiValues);
        titleEl.textContent = title || '确认操作';
        messageEl.textContent = message || '';
        confirmBtn.textContent = confirmText || '确认';
        confirmBtn.classList.toggle('danger', Boolean(danger));
        inputEl.style.display = input && !isMulti ? 'block' : 'none';
        inputEl.value = input ? value : '';
        multiEditor.style.display = isMulti ? 'flex' : 'none';
        multiAdd.style.display = isMulti ? 'block' : 'none';
        if (isMulti) renderMultiValueRows(multiValues);
        else multiEditor.innerHTML = '';
        saveAsFields.style.display = saveAs ? 'flex' : 'none';
        if (saveAs) {
            const categories = getAvailableCategories();
            saveAsName.value = saveAs.name || '';
            saveAsCategory.innerHTML = categories.map(category => (
                `<option value="${escapeHtml(category)}">${escapeHtml(window.UIVI18n ? UIVI18n.categoryLabel(category) : category)}</option>`
            )).join('');
            saveAsCategory.value = saveAs.category || categories[0] || '默认分类';
        } else {
            saveAsName.value = '';
            saveAsCategory.innerHTML = '';
        }
        overlay.classList.add('open');
        overlay.setAttribute('aria-hidden', 'false');
        if (saveAs) setTimeout(() => saveAsName.focus(), 30);
        else if (isMulti) setTimeout(() => multiEditor.querySelector('input')?.focus(), 30);
        else if (input) setTimeout(() => inputEl.focus(), 30);

        return new Promise(resolve => {
            activeDialog = { resolve, input, saveAs: Boolean(saveAs), multi: isMulti };
        });
    }

    function finishMiniDialog(confirmed) {
        const overlay = document.getElementById('scriptAnalysisMiniDialog');
        const inputEl = document.getElementById('scriptAnalysisMiniInput');
        const saveAsName = document.getElementById('scriptAnalysisSaveAsName');
        const saveAsCategory = document.getElementById('scriptAnalysisSaveAsCategory');
        if (!activeDialog) return;
        const { resolve, input, saveAs, multi } = activeDialog;
        activeDialog = null;
        if (overlay) {
            overlay.classList.remove('open');
            overlay.setAttribute('aria-hidden', 'true');
        }
        if (!confirmed) {
            resolve(null);
            return;
        }
        if (saveAs) {
            resolve({
                name: saveAsName.value.trim(),
                category: saveAsCategory.value
            });
            return;
        }
        if (multi) {
            resolve(getMultiValueRows());
            return;
        }
        resolve(input ? inputEl.value : true);
    }

    function confirmDialog() {
        finishMiniDialog(true);
    }

    function cancelDialog() {
        finishMiniDialog(false);
    }

    function getAvailableCategories() {
        const fromSidebar = window.UIVSidebar && UIVSidebar.getCategories ? UIVSidebar.getCategories() : [];
        const fromRows = analyzedRows.map(row => row.category).filter(Boolean);
        const categories = [...new Set([...fromSidebar, ...fromRows, '默认分类'])];
        return categories.length ? categories : ['默认分类'];
    }

    function getRememberedCategory(fallback) {
        const remembered = localStorage.getItem(SAVE_AS_CATEGORY_KEY);
        const categories = getAvailableCategories();
        if (remembered && categories.includes(remembered)) return remembered;
        if (fallback && categories.includes(fallback)) return fallback;
        return categories[0] || '默认分类';
    }

    function makeScriptId() {
        if (window.crypto && crypto.randomUUID) {
            return 'script_' + crypto.randomUUID().replace(/-/g, '').slice(0, 9);
        }
        return 'script_' + Math.random().toString(36).slice(2, 11);
    }

    function escapeHtml(value) {
        return text(value, '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[ch]));
    }

    function encodeAttrValue(value) {
        return encodeURIComponent(String(value ?? ''));
    }

    function decodeAttrValue(value) {
        try {
            return decodeURIComponent(String(value || ''));
        } catch (e) {
            return String(value || '');
        }
    }

    function compactValue(value) {
        if (value === null || value === undefined || value === '') return '';
        if (Array.isArray(value)) {
            if (value.length === 0) return '空';
            return value.map(compactValue).filter(Boolean).join(' / ');
        }
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    }

    function isEmptyFilterValue(value) {
        return value === null || value === undefined || value === ''
            || (Array.isArray(value) && value.length === 0);
    }

    function editValue(value) {
        if (value === null || value === undefined || value === '') return '';
        if (Array.isArray(value)) return value.map(editValue).filter(Boolean).join(',');
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    }

    function shortDisplayValue(value, maxItems = 3) {
        if (value === null || value === undefined || value === '') return '';
        if (Array.isArray(value)) {
            if (value.length === 0) return '空';
            const visible = value.slice(0, maxItems).map(item => shortDisplayValue(item, maxItems)).filter(Boolean);
            return visible.join(' / ') + (value.length > maxItems ? ` · 共${value.length}项` : '');
        }
        if (typeof value === 'string' && (value.includes(';') || value.includes(','))) {
            const separator = getValueSeparator(value);
            const parts = splitMultiString(value, separator);
            if (parts.length > 1) return shortDisplayValue(parts, maxItems);
        }
        if (typeof value === 'object') return JSON.stringify(value);
        const str = String(value);
        return str.length > 96 ? str.slice(0, 96) + '...' : str;
    }

    function getDeepFirst(obj, key) {
        if (!obj || typeof obj !== 'object') return '';
        if (obj[key] !== undefined && obj[key] !== null && typeof obj[key] !== 'object') return obj[key];
        if (obj[key] !== undefined && obj[key] !== null && Array.isArray(obj[key])) return obj[key];
        for (const itemKey of Object.keys(obj)) {
            const found = getDeepFirst(obj[itemKey], key);
            if (found !== '') return found;
        }
        return '';
    }

    function joinPath(path) {
        if (!path || path.length === 0) return '$';
        return path.reduce((out, part) => {
            if (String(part).startsWith('[')) return out + part;
            return out ? `${out}.${part}` : part;
        }, '');
    }

    function collectCoreGroups(payload, keyDefs) {
        const groups = [];
        const seenGroups = new Set();

        function walk(obj, path = []) {
            if (!obj || typeof obj !== 'object') return;
            if (Array.isArray(obj)) {
                obj.forEach((item, index) => walk(item, path.concat(`[${index}]`)));
                return;
            }

            const items = [];
            keyDefs.forEach(({ label, key }) => {
                if (!Object.prototype.hasOwnProperty.call(obj, key) || obj[key] === undefined || obj[key] === null) return;
                const value = compactValue(obj[key]);
                if (value && value !== '空') items.push([label, value]);
            });

            if (items.length > 0) {
                const pathText = joinPath(path);
                const signature = `${pathText}:${items.map(([label, value]) => `${label}=${value}`).join('|')}`;
                if (!seenGroups.has(signature)) {
                    seenGroups.add(signature);
                    groups.push({ id: `G${groups.length + 1}`, path: pathText, items });
                }
            }

            Object.keys(obj).forEach(itemKey => walk(obj[itemKey], path.concat(itemKey)));
        }

        walk(payload);
        return groups;
    }

    function flattenCoreGroups(groups) {
        const seen = new Set();
        const out = [];
        (groups || []).forEach(group => {
            (group.items || []).forEach(([label, value]) => {
                const signature = `${label}=${value}`;
                if (seen.has(signature)) return;
                seen.add(signature);
                out.push([label, value]);
            });
        });
        return out;
    }

    function collectColumnFilters(obj, out = [], seen = new Set()) {
        if (!obj || typeof obj !== 'object') return out;
        if (Array.isArray(obj)) {
            obj.forEach(item => collectColumnFilters(item, out, seen));
            return out;
        }

        if (typeof obj.column === 'string') {
            const label = obj.column;
            const rawValue = obj.values !== undefined ? obj.values : obj.value;
            const value = compactValue(rawValue);
            const displayValue = shortDisplayValue(rawValue);
            const signature = `${label}=${value}`;
            if (!seen.has(signature)) {
                seen.add(signature);
                out.push({
                    key: label,
                    rawValue,
                    value,
                    displayValue,
                    editValue: editValue(rawValue),
                    isEmpty: isEmptyFilterValue(rawValue),
                    source: obj.table || obj.componentUrl || ''
                });
            }
        }

        Object.keys(obj).forEach(key => collectColumnFilters(obj[key], out, seen));
        return out;
    }

    function collectTopLevelFilters(payload) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
        const ignored = new Set([
            'page_type', 'get_total', 'limit', 'start', 'need_summary', 'group_by',
            'pageNum', 'pageSize', 'maxRows', 'calStatistic', 'refreshCache',
            'srcTenantId', 'boardId', 'behavior', 'boardName', 'pageName', 'pageId', 'answerParamList'
        ]);
        return Object.keys(payload)
            .filter(key => !ignored.has(key))
            .map(key => ({
                key,
                rawValue: payload[key],
                value: compactValue(payload[key]),
                displayValue: shortDisplayValue(payload[key]),
                editValue: editValue(payload[key]),
                isEmpty: isEmptyFilterValue(payload[key]),
                source: ''
            }))
            .filter(item => item.value !== 'default');
    }

    function countEmptyTopLevelFilterParams(payload) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 0;
        const ignored = new Set([
            'page_type', 'get_total', 'limit', 'start', 'need_summary', 'group_by',
            'pageNum', 'pageSize', 'maxRows', 'calStatistic', 'refreshCache',
            'srcTenantId', 'boardId', 'behavior', 'boardName', 'pageName', 'pageId', 'answerParamList'
        ]);
        return Object.keys(payload)
            .filter(key => !ignored.has(key))
            .filter(key => payload[key] === '' || (Array.isArray(payload[key]) && payload[key].length === 0))
            .length;
    }

    function rebuildFilters(payload) {
        const columnFilters = collectColumnFilters(payload);
        return columnFilters.length > 0 ? columnFilters : collectTopLevelFilters(payload);
    }

    function applyFilterValue(payload, key, nextValue) {
        let changed = false;
        function walk(obj) {
            if (!obj || typeof obj !== 'object') return;
            if (Array.isArray(obj)) {
                obj.forEach(walk);
                return;
            }
            if (obj.column === key) {
                obj.values = Array.isArray(nextValue) ? nextValue : [nextValue];
                changed = true;
            }
            Object.keys(obj).forEach(itemKey => walk(obj[itemKey]));
        }

        walk(payload);
        if (!changed && payload && Object.prototype.hasOwnProperty.call(payload, key)) {
            payload[key] = nextValue;
            changed = true;
        }
        return changed;
    }

    function removeColumnFilters(obj, key) {
        if (!obj || typeof obj !== 'object') return false;
        let changed = false;
        if (Array.isArray(obj)) {
            for (let i = obj.length - 1; i >= 0; i--) {
                const item = obj[i];
                if (item && typeof item === 'object' && item.column === key) {
                    obj.splice(i, 1);
                    changed = true;
                } else if (removeColumnFilters(item, key)) {
                    changed = true;
                }
            }
            return changed;
        }
        Object.keys(obj).forEach(itemKey => {
            if (removeColumnFilters(obj[itemKey], key)) changed = true;
        });
        return changed;
    }

    function removeFilter(payload, key) {
        const changed = removeColumnFilters(payload, key);
        if (!changed && payload && Object.prototype.hasOwnProperty.call(payload, key)) {
            delete payload[key];
            return true;
        }
        return changed;
    }

    function parseCodeHints(code) {
        const raw = typeof code === 'string' ? code : '';
        const urlMatch = raw.match(/URL:\s*(https?:\/\/[^\s*]+)/) || raw.match(/fetch\("([^"]+)"/);
        const pageNameMatch = raw.match(/"pageName"\s*:\s*"([^"]+)"/);
        const pageIdMatch = raw.match(/"pageId"\s*:\s*"([^"]+)"/);
        const boardIdMatch = raw.match(/"boardId"\s*:\s*"([^"]+)"/);
        const tenantMatch = raw.match(/"srcTenantId"\s*:\s*"([^"]+)"/);
        const componentMatch = raw.match(/"id"\s*:\s*"([^"]+)"/);
        const outputMatch = raw.match(/(?:let|const|var)?\s*finalOutputName\s*=\s*(["'`])(.*?)\1/);
        const url = urlMatch ? urlMatch[1] : '';
        const endpoint = url ? url.split('?')[0].replace(/\/+$/, '').split('/').pop() : '';
        const serviceMatch = url.match(/\/services\/+([^/?]+)|\/legacy\/services\/+([^/?]+)/);
        return {
            url,
            endpoint,
            serviceName: serviceMatch ? (serviceMatch[1] || serviceMatch[2] || '') : '',
            pageName: pageNameMatch ? pageNameMatch[1] : '',
            pageId: pageIdMatch ? pageIdMatch[1] : '',
            boardId: boardIdMatch ? boardIdMatch[1] : '',
            tenantId: tenantMatch ? tenantMatch[1] : '',
            componentId: componentMatch ? componentMatch[1] : '',
            outputName: outputMatch ? outputMatch[1] : '',
            hasPagination: /pageNum = currentPage|start = \(currentPage - 1\)/.test(raw),
            hasForceSum: /getValueTableSumData/.test(raw),
            hasDynamicCpc: /board\/pageView|CPC\[0-9\]/.test(raw),
            hasDynamicNid: /op_ex_rectify_check_special_nid/.test(raw),
            hasRuntimeMonth: (/runConfigs\s*=\s*\[/.test(raw) && /currentYear/.test(raw) && /prevYear/.test(raw))
                || (/currentStartStr|prevStartStr/.test(raw) && /年"\s*\+\s*config\.month|config\.year\s*\+\s*"年"/.test(raw)),
            auth: raw.includes('x-xsrf-token') ? 'Cookie XSRF' : (raw.includes('x-gde-csrf-token') ? 'localStorage CSRF' : '默认')
        };
    }

    function buildCoreObjects({ platform, payload, codeHints, tenantId, boardId, pageId, componentId, id }) {
        let groups;
        if (platform === 'DataFab') {
            groups = collectCoreGroups(payload, [
                { label: 'tenant', key: 'srcTenantId' },
                { label: 'board', key: 'boardId' },
                { label: 'page', key: 'pageId' },
                { label: 'componentId', key: 'componentId' },
                { label: 'id', key: 'id' }
            ]);
            const fallbackItems = [
                ['tenant', tenantId],
                ['board', boardId],
                ['page', pageId],
                ['componentId', componentId],
                ['id', id]
            ].filter(item => item[1]);
            if (fallbackItems.length > 0) {
                const existingLabels = new Set(groups.flatMap(group => group.items.map(([label]) => label)));
                const missingItems = fallbackItems.filter(([label]) => !existingLabels.has(label));
                if (missingItems.length > 0) groups.push({ id: `G${groups.length + 1}`, path: '代码提示', items: missingItems });
            }
            return { entries: flattenCoreGroups(groups), groups };
        }

        groups = [];
        const urlItems = [
            ['endpoint', codeHints.endpoint],
            ['service', codeHints.serviceName]
        ].filter(item => item[1] && item[1] !== '空');
        if (urlItems.length > 0) groups.push({ id: 'G1', path: 'URL', items: urlItems });

        const payloadGroups = collectCoreGroups(payload, [
            { label: 'product_line', key: 'product_line' },
            { label: 'group_by', key: 'group_by' },
            { label: 'region_code', key: 'region_code' },
            { label: 'office_code', key: 'office_code' },
            { label: 'country_code', key: 'country_code' }
        ]).map((group, index) => ({ ...group, id: `G${groups.length + index + 1}` }));
        groups.push(...payloadGroups);
        return { entries: flattenCoreGroups(groups), groups };
    }

    function platformFromUrl(url, category) {
        const lower = String(url || category || '').toLowerCase();
        if (lower.includes('datafab')) return 'DataFab';
        if (lower.includes('netcare')) return 'NetCare';
        return 'Custom';
    }

    function optionState(script, codeHints, key, fallback = false) {
        if (script.configOptions && script.configOptions[key] !== undefined) return Boolean(script.configOptions[key]);
        const fallbackMap = {
            isPagination: codeHints.hasPagination,
            forceSumData: codeHints.hasForceSum,
            autoFetchCPC: codeHints.hasDynamicCpc || codeHints.hasDynamicNid,
            autoRuntimeMonth: codeHints.hasRuntimeMonth,
            useGlobalVars: /storedVars\['global_/.test(script.code || ''),
            autoNetCareTriplicate: false
        };
        return fallbackMap[key] !== undefined ? fallbackMap[key] : fallback;
    }

    function buildConfigOptions(script, codeHints) {
        return {
            useGlobalVars: optionState(script, codeHints, 'useGlobalVars'),
            isPagination: optionState(script, codeHints, 'isPagination'),
            forceSumData: optionState(script, codeHints, 'forceSumData'),
            autoFetchCPC: optionState(script, codeHints, 'autoFetchCPC'),
            autoRuntimeMonth: optionState(script, codeHints, 'autoRuntimeMonth'),
            autoNetCareTriplicate: optionState(script, codeHints, 'autoNetCareTriplicate')
        };
    }

    function analyzeScript(script) {
        const basePayload = safeJsonParse(script.payload) || parsePayloadFromCode(script.code || script.consoleCode || '');
        const payload = modifiedRows.get(script.id)?.payload || basePayload;
        const codeHints = parseCodeHints(script.code || script.consoleCode || '');
        const url = script.url || codeHints.url || '';
        const platform = platformFromUrl(url, script.category);
        const pageName = text(payload ? getDeepFirst(payload, 'pageName') : codeHints.pageName, '');
        const outputName = codeHints.outputName || (script.originalFileName
            ? `${script.originalFileName}${pageName ? '_' + pageName : ''}_Latest.csv`
            : text(script.name, '').replace(/(_CN|_AE|_DE)$/, '') + '_Latest.csv');
        const realComponentId = text(payload ? getDeepFirst(payload, 'componentId') : codeHints.componentId, '');
        const realId = text(payload ? getDeepFirst(payload, 'id') : '', '');
        const pageId = text(payload ? getDeepFirst(payload, 'pageId') : codeHints.pageId, '');
        const boardId = text(payload ? getDeepFirst(payload, 'boardId') : codeHints.boardId, '');
        const tenantId = text(payload ? getDeepFirst(payload, 'srcTenantId') : codeHints.tenantId, '');
        const coreResult = buildCoreObjects({ platform, payload, codeHints, tenantId, boardId, pageId, componentId: realComponentId, id: realId });
        const limitVal = payload
            ? (payload.limit || getDeepFirst(payload, 'pageSize') || getDeepFirst(payload, 'maxRows'))
            : '';
        let filters = payload ? collectColumnFilters(payload) : [];
        if (filters.length === 0 && payload) filters = collectTopLevelFilters(payload);
        const emptyFilterCount = filters.length === 0 && payload ? countEmptyTopLevelFilterParams(payload) : 0;

        const configOptions = script.configOptions || buildConfigOptions(script, codeHints);
        const optionSummary = [
            { key: 'useGlobalVars', label: window.UIVT ? window.UIVT('uiv.analysis.optGlobalVars') : '全局变量', on: configOptions.useGlobalVars },
            { key: 'isPagination', label: window.UIVT ? window.UIVT('uiv.analysis.optPagination') : '翻页', on: configOptions.isPagination },
            { key: 'forceSumData', label: window.UIVT ? window.UIVT('uiv.analysis.optForceSum') : '强制总数', on: configOptions.forceSumData },
            { key: 'autoFetchCPC', label: window.UIVT ? window.UIVT('uiv.analysis.optAutoCpc') : '动态CPC/NID', on: configOptions.autoFetchCPC },
            { key: 'autoRuntimeMonth', label: window.UIVT ? window.UIVT('uiv.analysis.optAutoMonth') : '双月', on: configOptions.autoRuntimeMonth },
            { key: 'autoNetCareTriplicate', label: window.UIVT ? window.UIVT('uiv.analysis.optTriplicate') : '三区阵列', on: configOptions.autoNetCareTriplicate }
        ];

        const responseRules = platform === 'DataFab'
            ? ['data[0].data', 'totalsData/sumData', optionState(script, codeHints, 'forceSumData') ? 'getValueTableSumData' : '原生汇总']
            : ['data.data/list/items/records', 'results/items/list/data', payload && payload.need_summary ? 'need_summary' : '无汇总标记'];

        return {
            id: script.id,
            script,
            payload,
            isDirty: modifiedRows.has(script.id),
            dirtyFields: modifiedRows.get(script.id)?.dirtyFields || new Set(),
            category: script.category || '默认分类',
            name: script.name || '',
            outputName,
            url,
            platform,
            method: 'POST',
            auth: codeHints.auth || (platform === 'DataFab' ? 'Cookie XSRF' : 'localStorage CSRF'),
            tenantId,
            boardId,
            pageId,
            componentId: realComponentId || realId,
            coreObjects: coreResult.entries,
            coreGroups: coreResult.groups,
            pageName,
            limitVal,
            filters,
            emptyFilterCount,
            configOptions,
            options: optionSummary,
            responseRules,
            canRefill: Boolean(script.payload && script.configOptions),
            hasPayload: Boolean(script.payload),
            hasConfig: Boolean(script.configOptions),
            updatedAt: script.updatedAt || script.createdAt || ''
        };
    }

    function formatLocalTime(isoString) {
        if (!isoString) return '-';
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return '-';
        const pad = n => n.toString().padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}<br><span class="analysis-muted">${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}</span>`;
    }

    function renderPills(items, className = '') {
        if (!items || items.length === 0) return '<span class="analysis-muted">-</span>';
        return `<div class="analysis-pill-list">${items.map(item => (
            `<span class="analysis-pill ${className}">${escapeHtml(item)}</span>`
        )).join('')}</div>`;
    }

    function renderFilterPills(row, filters, freqMap) {
        if (!filters || filters.length === 0) {
            return `<span class="analysis-muted">${window.UIVT ? window.UIVT('uiv.analysis.noFilters') : '未识别到筛选字段'}</span>`;
        }
        const expanded = expandedFilterRows.has(row.id);
        const valuedFilters = filters.filter(item => !item.isEmpty);
        const collapsedFilters = (valuedFilters.length ? valuedFilters : filters).slice(0, 10);
        const visible = expanded ? filters : collapsedFilters;
        const emptyCount = filters.filter(item => item.isEmpty).length;
        const extra = filters.length > visible.length || expanded
            ? `<button class="analysis-filter-toggle" onclick="event.stopPropagation(); UIVScriptAnalysis.toggleFilters('${escapeHtml(row.id)}')">${expanded ? '收起' : `展开全部 ${filters.length} 项${emptyCount ? ` · 含${emptyCount}个空值` : ''}`}</button>`
            : '';
        const emptyHint = !expanded && emptyCount > 0 && valuedFilters.length > 0
            ? `<span class="analysis-pill off">${window.UIVT ? window.UIVT('uiv.analysis.otherEmptyFilters', { count: emptyCount }) : `另${emptyCount}个空值字段`}</span>`
            : '';
        const emptyLabel = window.UIVT ? window.UIVT('uiv.analysis.emptyValue') : '空值';
        const deleteFieldTitle = window.UIVT ? window.UIVT('uiv.analysis.deleteFilterBtn') : '删除字段';
        return `<div class="analysis-pill-list">${visible.map(item => {
            const dupKey = `filter:${item.key}=${item.value}`;
            const isDup = !item.isEmpty && freqMap && freqMap.get(dupKey) > 1;
            const isDirty = row.dirtyFields && row.dirtyFields.has(`filter:${item.key}`);
            const dupClass = isDup ? ' duplicate' : '';
            const dirtyClass = isDirty ? ' unsaved-field' : '';
            const dupAttr = isDup ? ` data-dup-key="${escapeHtml(dupKey)}"` : '';
            return `<span class="analysis-pill editable ${item.isEmpty ? 'empty' : ''}${dupClass}${dirtyClass}"${dupAttr} title="${escapeHtml(item.value ? `${item.key}=${item.value}${isDup ? ' (在多条脚本中复用)' : ''}` : `${item.key}=${emptyLabel}，可点击编辑`)}" onclick="event.stopPropagation(); UIVScriptAnalysis.editFilter('${escapeHtml(row.id)}', '${escapeHtml(item.key)}')">
                ${escapeHtml(item.key)}${item.displayValue ? '=' + escapeHtml(item.displayValue) : '=' + emptyLabel}
                <button class="analysis-filter-remove" title="${deleteFieldTitle}" onclick="event.stopPropagation(); UIVScriptAnalysis.deleteFilter('${escapeHtml(row.id)}', '${escapeHtml(item.key)}')">×</button>
            </span>`;
        }).join('')}${emptyHint}${extra}</div>`;
    }

    function renderOptionPills(options) {
        const onLabel = window.UIVT ? window.UIVT('uiv.analysis.switchOn') : '开';
        const offLabel = window.UIVT ? window.UIVT('uiv.analysis.switchOff') : '关';
        return `<div class="analysis-pill-list">${options.map(opt => {
            const label = opt.key && window.UIVT ? (
                opt.key === 'useGlobalVars' ? window.UIVT('uiv.analysis.optGlobalVars') :
                opt.key === 'isPagination' ? window.UIVT('uiv.analysis.optPagination') :
                opt.key === 'forceSumData' ? window.UIVT('uiv.analysis.optForceSum') :
                opt.key === 'autoFetchCPC' ? window.UIVT('uiv.analysis.optAutoCpc') :
                opt.key === 'autoRuntimeMonth' ? window.UIVT('uiv.analysis.optAutoMonth') :
                opt.key === 'autoNetCareTriplicate' ? window.UIVT('uiv.analysis.optTriplicate') : opt.label
            ) : opt.label;
            return `<span class="analysis-pill ${opt.on ? 'good' : 'off'}">${escapeHtml(label)}:${opt.on ? onLabel : offLabel}</span>`;
        }).join('')}</div>`;
    }

    function renderCoreObjects(row, freqMap) {
        if (!row.coreObjects || row.coreObjects.length === 0) {
            return `<span class="analysis-muted">${window.UIVT ? window.UIVT('uiv.analysis.noCore') : '脚本中未识别到核心对象'}</span>`;
        }
        const groups = row.coreGroups && row.coreGroups.length > 0
            ? row.coreGroups
            : [{ id: 'G1', path: '兼容视图', items: row.coreObjects }];
        return `<div class="analysis-core-groups">${groups.map(group => {
            const groupTitle = `组 ${group.id}${group.path ? ` · ${group.path}` : ''}`;
            return `<div class="analysis-core-group" title="${escapeHtml(groupTitle)}">
                <span class="analysis-core-group-id">${escapeHtml(group.id)}</span>
                <div class="analysis-pill-list">${(group.items || []).map(([label, value]) => renderCoreObjectPill(row, freqMap, label, value, group.path)).join('')}</div>
            </div>`;
        }).join('')}</div>`;
    }

    function renderCoreObjectPill(row, freqMap, label, value, groupPath = '') {
            if (label === 'endpoint' || label === 'service') {
                return `<span class="analysis-pill off" style="cursor:pointer;" title="点击复制内容 (URL提取不可修改)" data-copy-val="${escapeHtml(value)}" onclick="event.stopPropagation(); UIVScriptAnalysis.copyCellText(this.getAttribute('data-copy-val'))">${escapeHtml(label)}=${escapeHtml(shortDisplayValue(value))}</span>`;
            }
            const dupKey = `core:${label}=${value}`;
            const isDup = freqMap && freqMap.get(dupKey) > 1;
            const isDirty = row.dirtyFields && row.dirtyFields.has(`core:${label}`);
            const dupClass = isDup ? ' duplicate' : '';
            const dirtyClass = isDirty ? ' unsaved-field' : '';
            const dupAttr = isDup ? ` data-dup-key="${escapeHtml(dupKey)}"` : '';
            return `<span class="analysis-pill editable${dupClass}${dirtyClass}"${dupAttr} title="点击编辑: ${escapeHtml(label)}=${escapeHtml(value)}${isDup ? ' (在多条脚本中复用)' : ''}" onclick="event.stopPropagation(); UIVScriptAnalysis.editCoreObject('${escapeHtml(row.id)}', '${escapeHtml(label)}', '${encodeAttrValue(value)}', '${encodeAttrValue(groupPath)}')">${escapeHtml(label)}=${escapeHtml(shortDisplayValue(value))}</span>`;
    }

    function copyCellText(text) {
        if (!text || text === '-' || text === '空' || text === 'Empty') return;
        navigator.clipboard.writeText(text).then(() => {
            if (window.showToast) {
                const toastMsg = window.UIVT ? window.UIVT('uiv.analysis.copySuccess', { text: text.length > 30 ? text.substring(0, 30) + '...' : text }) : `已复制: ${text.length > 30 ? text.substring(0, 30) + '...' : text}`;
                showToast(toastMsg);
            }
        }).catch(err => {
            console.error('复制失败', err);
            if (window.showToast) {
                const failMsg = window.UIVT ? window.UIVT('uiv.analysis.copyFail') : '复制失败';
                showToast(failMsg, 'error');
            }
        });
    }

    function rowMatches(row, keyword, category) {
        if (category && row.category !== category) return false;
        if (!keyword) return true;
        const haystack = [
            row.category, row.name, row.outputName, row.url, row.platform,
            row.tenantId, row.boardId, row.pageId, row.componentId, row.pageName,
            row.coreObjects.map(item => item.join('=')).join(' '),
            (row.coreGroups || []).map(group => `${group.id} ${group.path || ''}`).join(' '),
            row.filters.map(item => `${item.key}=${item.value}`).join(' ')
        ].join(' ').toLowerCase();
        return haystack.includes(keyword.toLowerCase());
    }

    function updateCategoryFilter() {
        const select = document.getElementById('scriptAnalysisCategory');
        if (!select) return;
        const current = select.value;
        const categories = [...new Set(analyzedRows.map(row => row.category))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
        const allCatLabel = window.UIVT ? window.UIVT('uiv.analysis.allCategories') : '全部分类';
        select.innerHTML = `<option value="">${escapeHtml(allCatLabel)}</option>` + categories.map(cat => (
            `<option value="${escapeHtml(cat)}">${escapeHtml(window.UIVI18n ? UIVI18n.categoryLabel(cat) : cat)}</option>`
        )).join('');
        if (categories.includes(current)) select.value = current;
    }

    function render() {
        const tbody = document.getElementById('scriptAnalysisRows');
        const summary = document.getElementById('scriptAnalysisSummary');
        updateSaveButtonState();
        if (!tbody) return;
        const keyword = document.getElementById('scriptAnalysisSearch')?.value.trim() || '';
        const category = document.getElementById('scriptAnalysisCategory')?.value || '';
        const rows = analyzedRows.filter(row => rowMatches(row, keyword, category));

        if (summary) {
            const datafabCount = analyzedRows.filter(row => row.platform === 'DataFab').length;
            const netcareCount = analyzedRows.filter(row => row.platform === 'NetCare').length;
            summary.textContent = window.UIVT ? window.UIVT('uiv.analysis.summary', {
                total: analyzedRows.length,
                datafab: datafabCount,
                netcare: netcareCount,
                current: rows.length
            }) : `共 ${analyzedRows.length} 条脚本 · DataFab ${datafabCount} · NetCare ${netcareCount} · 当前显示 ${rows.length}`;
        }

        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="13" class="script-analysis-empty">${window.UIVT ? window.UIVT('uiv.analysis.noMatches') : '没有匹配的脚本'}</td></tr>`;
            return;
        }

        const freqMap = new Map();
        analyzedRows.forEach(r => {
            r.coreObjects.forEach(([lbl, val]) => {
                if (lbl === 'endpoint' || lbl === 'service') return;
                const k = `core:${lbl}=${val}`;
                freqMap.set(k, (freqMap.get(k) || 0) + 1);
            });
            r.filters.forEach(item => {
                if (item.isEmpty) return;
                const k = `filter:${item.key}=${item.value}`;
                freqMap.set(k, (freqMap.get(k) || 0) + 1);
            });
        });

        const copyTitle = window.UIVT ? window.UIVT('uiv.analysis.copyCellTitle') : '点击复制内容';

        tbody.innerHTML = rows.map(row => `
            <tr class="${row.id === highlightedScriptId ? 'new-saved-row' : ''}" data-script-id="${escapeHtml(row.id)}" onclick="UIVScriptAnalysis.selectRow('${escapeHtml(row.id)}')" ondblclick="UIVScriptAnalysis.refill('${escapeHtml(row.id)}')">
                <td><div class="analysis-main-text" style="cursor:pointer;" title="${copyTitle}" onclick="event.stopPropagation(); UIVScriptAnalysis.copyCellText(this.innerText)">${escapeHtml(window.UIVI18n ? UIVI18n.categoryLabel(row.category) : row.category)}</div></td>
                <td><div class="analysis-main-text" style="cursor:pointer;" title="${copyTitle}" onclick="event.stopPropagation(); UIVScriptAnalysis.copyCellText(this.innerText)">${escapeHtml(row.name)}</div>${row.isDirty ? `<div class="analysis-muted">${window.UIVT ? window.UIVT('uiv.analysis.modifiedTag') : '已修改，待保存'}</div>` : ''}</td>
                <td><div class="analysis-main-text" style="cursor:pointer;" title="${copyTitle}" onclick="event.stopPropagation(); UIVScriptAnalysis.copyCellText(this.innerText)">${escapeHtml(row.outputName)}</div><div class="analysis-muted" style="cursor:pointer;" title="${copyTitle}" onclick="event.stopPropagation(); UIVScriptAnalysis.copyCellText(this.innerText)">${escapeHtml(row.pageName || '-')}</div></td>
                <td><div class="analysis-url" style="cursor:pointer;" title="${copyTitle}" onclick="event.stopPropagation(); UIVScriptAnalysis.copyCellText(this.innerText)">${escapeHtml(row.url || '-')}</div></td>
                <td><div style="font-size:11px;line-height:1.4;text-align:center;">${formatLocalTime(row.updatedAt)}</div></td>
                <td>${renderPills([row.platform], row.platform === 'DataFab' ? 'good' : '')}</td>
                <td>
                    ${renderPills([row.method, row.auth])}
                    <div class="analysis-muted">pageSize/maxRows: ${escapeHtml(row.limitVal || '-')}</div>
                </td>
                <td>${renderCoreObjects(row, freqMap)}</td>
                <td>${renderFilterPills(row, row.filters, freqMap)}</td>
                <td>${renderOptionPills(row.options)}</td>
                <td>${renderPills(row.responseRules, 'warn')}</td>
                <td>${renderPills([
                    row.hasPayload ? (window.UIVT ? window.UIVT('uiv.analysis.payloadOk') : 'Payload可还原') : (window.UIVT ? window.UIVT('uiv.analysis.payloadLegacy') : '旧脚本无Payload'),
                    row.hasConfig ? (window.UIVT ? window.UIVT('uiv.analysis.configOk') : '开关可还原') : (window.UIVT ? window.UIVT('uiv.analysis.configCode') : '开关靠代码识别')
                ], row.canRefill ? 'good' : 'warn')}</td>
                <td>
                    <button class="script-analysis-action ${row.isDirty ? 'changed' : ''}" onclick="event.stopPropagation(); UIVScriptAnalysis.copyModified('${escapeHtml(row.id)}')">${window.UIVT ? window.UIVT('uiv.analysis.copyModified') : '复制修改后脚本'}</button>
                    <button class="script-analysis-action saveas" onclick="event.stopPropagation(); UIVScriptAnalysis.saveAsNew('${escapeHtml(row.id)}')">${window.UIVT ? window.UIVT('uiv.analysis.saveAsNew') : '另存为新脚本'}</button>
                    <button class="script-analysis-action delete" onclick="event.stopPropagation(); UIVScriptAnalysis.deleteScript('${escapeHtml(row.id)}')">${window.UIVT ? window.UIVT('uiv.analysis.deleteScript') : '删除脚本'}</button>
                </td>
            </tr>
        `).join('');

        if (highlightedScriptId) {
            setTimeout(() => {
                const row = document.querySelector(`#scriptAnalysisRows tr[data-script-id="${CSS.escape(highlightedScriptId)}"]`);
                if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }, 80);
            setTimeout(() => {
                highlightedScriptId = '';
                const row = document.querySelector('#scriptAnalysisRows tr.new-saved-row');
                if (row) row.classList.remove('new-saved-row');
            }, 2600);
        }
    }

    function updateSaveButtonState() {
        const saveBtn = document.querySelector('.script-analysis-save');
        if (!saveBtn) return;
        const count = modifiedRows.size;
        saveBtn.classList.toggle('dirty', count > 0);
        saveBtn.textContent = count > 0
            ? (window.UIVT ? window.UIVT('uiv.analysis.saveChangesCount', { count }) : `保存修改 (${count})`)
            : (window.UIVT ? window.UIVT('uiv.analysis.saveChanges') : '保存修改');
    }

    function findRow(scriptId) {
        return analyzedRows.find(item => item.id === scriptId);
    }

    function setRowPayload(scriptId, payload, dirtyKey) {
        const row = findRow(scriptId);
        if (!row || !payload) return;
        const existing = modifiedRows.get(scriptId) || { payload: null, dirtyFields: new Set() };
        existing.payload = cloneJson(payload);
        if (dirtyKey) existing.dirtyFields.add(dirtyKey);
        modifiedRows.set(scriptId, existing);
        const idx = analyzedRows.findIndex(item => item.id === scriptId);
        if (idx >= 0) analyzedRows[idx] = analyzeScript(row.script);
        updateSaveButtonState();
    }

    function selectRow() {
        // 保留接口，方便表格行点击和未来键盘操作扩展。
    }

    function toggleFilters(scriptId) {
        if (expandedFilterRows.has(scriptId)) {
            expandedFilterRows.delete(scriptId);
        } else {
            expandedFilterRows.add(scriptId);
        }
        render();
    }

    async function editFilter(scriptId, key) {
        const row = findRow(scriptId);
        if (!row || !row.payload) {
            showToast('当前脚本没有可编辑 Payload', 'error');
            return;
        }
        const filter = row.filters.find(item => item.key === key);
        const currentValue = filter ? (filter.editValue || filter.value || '') : '';
        const separator = filter ? getValueSeparator(filter.rawValue !== undefined ? filter.rawValue : currentValue) : '';
        const useMultiEditor = filter && (
            Array.isArray(filter.rawValue)
            || (separator && !currentValue.trim().startsWith('{'))
        );
        const nextRaw = await openMiniDialog({
            title: `编辑筛选字段`,
            message: useMultiEditor
                ? `[${key}]\n一行一个值，可直接增删改。${separator === ';' ? '\n原字段使用英文分号 ; 分隔，保存时会继续用分号拼接。' : separator === ',' ? '\n原字段使用英文逗号 , 分隔，保存时会继续用逗号拼接。' : ''}`
                : `[${key}]\n多值请用英文逗号分隔；也可以直接粘贴 JSON 数组。`,
            input: true,
            value: currentValue,
            confirmText: '应用修改',
            multiValues: useMultiEditor ? normalizeMultiValues(filter.rawValue !== undefined ? filter.rawValue : currentValue, separator) : null
        });
        if (nextRaw === null) return;
        const finalValue = Array.isArray(nextRaw) && separator
            ? nextRaw.join(separator)
            : nextRaw;
        const nextPayload = cloneJson(row.payload);
        if (!applyFilterValue(nextPayload, key, parseEditedValue(finalValue))) {
            showToast('未找到可修改的字段', 'error');
            return;
        }
        setRowPayload(scriptId, nextPayload, `filter:${key}`);
        render();
    }

    async function editCoreObject(scriptId, label, encodedValue = '', encodedPath = '') {
        const row = findRow(scriptId);
        if (!row || !row.payload) {
            showToast('当前脚本没有可编辑 Payload', 'error');
            return;
        }

        const CORE_OBJ_KEY_MAP = {
            'tenant': 'srcTenantId',
            'board': 'boardId',
            'page': 'pageId',
            'componentId': 'componentId',
            'id': 'id',
            'product_line': 'product_line',
            'group_by': 'group_by',
            'region_code': 'region_code',
            'office_code': 'office_code',
            'country_code': 'country_code'
        };

        let payloadKey = CORE_OBJ_KEY_MAP[label];

        if (!payloadKey) {
            showToast('该核心对象不支持在此直接修改', 'error');
            return;
        }

        const requestedValue = decodeAttrValue(encodedValue);
        const requestedPath = decodeAttrValue(encodedPath);
        const objArr = row.coreObjects.find(item => item[0] === label && (!requestedValue || item[1] === requestedValue))
            || row.coreObjects.find(item => item[0] === label);
        const currentValue = objArr ? objArr[1] : '';

        const nextRaw = await openMiniDialog({
            title: `编辑核心对象`,
            message: `[${label}] -> 映射到 Payload Key: ${payloadKey}`,
            input: true,
            value: currentValue,
            confirmText: '应用修改'
        });

        if (nextRaw === null) return;

        const nextPayload = cloneJson(row.payload);
        
        let changed = false;
        const shouldMatchCurrentValue = row.coreObjects.filter(item => item[0] === label).length > 1 && requestedValue;
        function walk(obj, path = []) {
            if (!obj || typeof obj !== 'object') return;
            if (Array.isArray(obj)) {
                obj.forEach((item, index) => walk(item, path.concat(`[${index}]`)));
                return;
            }
            if (Object.prototype.hasOwnProperty.call(obj, payloadKey)) {
                const isRequestedGroup = !requestedPath || requestedPath === '代码提示' || joinPath(path) === requestedPath;
                if (isRequestedGroup && (!shouldMatchCurrentValue || compactValue(obj[payloadKey]) === requestedValue)) {
                    obj[payloadKey] = parseEditedValue(nextRaw);
                    changed = true;
                }
            }
            Object.keys(obj).forEach(itemKey => walk(obj[itemKey], path.concat(itemKey)));
        }
        walk(nextPayload);

        if (!changed) {
            showToast(`未在 Payload 中找到 ${payloadKey} 字段，可能格式不兼容`, 'error');
            return;
        }

        setRowPayload(scriptId, nextPayload, `core:${label}`);
        render();
    }

    async function deleteFilter(scriptId, key) {
        const row = findRow(scriptId);
        if (!row || !row.payload) {
            showToast(window.UIVT ? window.UIVT('uiv.analysis.noFilters') : '当前脚本没有可编辑 Payload', 'error');
            return;
        }
        const confirmed = await openMiniDialog({
            title: window.UIVT ? window.UIVT('uiv.analysis.deleteFilterTitle') : '删除筛选字段',
            message: window.UIVT ? window.UIVT('uiv.analysis.deleteFilterConfirm', { key }) : `确定删除筛选字段 [${key}] 吗？\n保存前只会影响当前分析窗口里的待保存版本。`,
            confirmText: window.UIVT ? window.UIVT('uiv.analysis.deleteFilterBtn') : '删除字段',
            danger: true
        });
        if (!confirmed) return;
        const nextPayload = cloneJson(row.payload);
        if (!removeFilter(nextPayload, key)) {
            showToast(window.UIVT ? window.UIVT('uiv.analysis.noFilters') : '未找到可删除的字段', 'error');
            return;
        }
        setRowPayload(scriptId, nextPayload, `filter:${key}`);
        render();
    }

    function buildUpdatedScript(row) {
        const payload = modifiedRows.get(row.id)?.payload || row.payload;
        const payloadText = payload ? JSON.stringify(payload, null, 4) : (row.script.payload || '');
        return {
            ...row.script,
            url: row.script.url || row.url,
            payload: payloadText,
            code: replaceBasePayloadInCode(row.script.code || '', payload, row),
            consoleCode: replaceBasePayloadInCode(row.script.consoleCode || '', payload, row),
            configOptions: row.script.configOptions || row.configOptions
        };
    }

    function renameScriptArtifacts(script, newName) {
        const clean = String(newName || '').trim().replace(/\.csv$/i, '');
        const outputName = /_Latest$/i.test(clean) ? `${clean}.csv` : `${clean}_Latest.csv`;
        const replaceOutput = code => {
            if (!code || typeof code !== 'string') return code || '';
            try {
                const parsed = JSON.parse(code);
                if (parsed && typeof parsed === 'object') {
                    parsed.Name = newName;
                    if (Array.isArray(parsed.Commands)) {
                        parsed.Commands.forEach(cmd => {
                            if (cmd.Target && typeof cmd.Target === 'string') {
                                cmd.Target = cmd.Target.replace(
                                    /((?:let|const|var)?\s*finalOutputName\s*=\s*)(["'`])(?:\\.|(?!\2)[^\\])*\2/g,
                                    `$1${JSON.stringify(outputName)}`
                                );
                            }
                        });
                    }
                    return JSON.stringify(parsed, null, 2);
                }
            } catch (_) {}
            return code.replace(
                /((?:let|const|var)?\s*finalOutputName\s*=\s*)(["'`])(?:\\.|(?!\2)[^\\])*\2/g,
                `$1${JSON.stringify(outputName)}`
            );
        };
        return {
            ...script,
            name: newName,
            originalFileName: newName,
            code: replaceOutput(script.code),
            consoleCode: replaceOutput(script.consoleCode)
        };
    }

    async function copyModified(scriptId) {
        const row = findRow(scriptId);
        if (!row) return;
        const updated = buildUpdatedScript(row);
        const code = updated.consoleCode || updated.code || '';
        if (!code) {
            showToast(window.UIVT ? window.UIVT('uiv.copy.noCode') : '当前脚本没有可复制代码', 'error');
            return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(code);
            showToast(window.UIVT ? window.UIVT('uiv.analysis.copiedModifiedScript') : '修改后脚本已复制');
            return;
        }
        if (window.UIVCopy && UIVCopy.copyFromMemory) {
            UIVCopy.copyFromMemory(code, window.UIVT ? window.UIVT('uiv.analysis.copyModified') : '修改后脚本');
        }
    }

    async function saveAsNew(scriptId) {
        const row = findRow(scriptId);
        if (!row) return;
        const defaultName = `${row.name}_副本`;
        const result = await openMiniDialog({
            title: window.UIVT ? window.UIVT('uiv.analysis.saveAsTitle') : '另存为新脚本',
            message: window.UIVT ? window.UIVT('uiv.analysis.saveAsMessage') : '为当前脚本副本命名并选择保存分类。当前分析窗口里的待修改筛选字段也会一并带入新脚本。',
            confirmText: window.UIVT ? window.UIVT('uiv.analysis.saveAsConfirm') : '另存为',
            saveAs: {
                name: defaultName,
                category: getRememberedCategory(row.category)
            }
        });
        if (!result) return;

        const newName = result.name.trim();
        const category = result.category || (window.UIVT ? window.UIVT('uiv.analysis.defaultCategory') : '默认分类');
        if (!newName) {
            showToast(window.UIVT ? window.UIVT('uiv.analysis.nameRequired') : '请填写新脚本名称', 'error');
            return;
        }
        if (rawScripts.some(script => script.name === newName)) {
            showToast(window.UIVT ? window.UIVT('uiv.analysis.nameExists') : '脚本名称已存在，请换一个名称', 'error');
            return;
        }

        const base = buildUpdatedScript(row);
        const newScript = renameScriptArtifacts({
            ...base,
            id: makeScriptId(),
            category
        }, newName);

        try {
            await API.post('/api/uiv/scripts', { items: [newScript] });
            localStorage.setItem(SAVE_AS_CATEGORY_KEY, category);
            highlightedScriptId = newScript.id;
            showToast(window.UIVT ? window.UIVT('uiv.analysis.saveAsSuccess', { name: newName }) : `已另存为新脚本：${newName}`);
            const search = document.getElementById('scriptAnalysisSearch');
            const categorySelect = document.getElementById('scriptAnalysisCategory');
            if (search) search.value = '';
            if (window.UIVSidebar && UIVSidebar.loadSavedScripts) {
                await UIVSidebar.loadSavedScripts({ reason: 'analysis-save-as' });
            }
            await loadScripts(true);
            updateCategoryFilter();
            if (categorySelect) categorySelect.value = category;
            render();
        } catch (error) {
            console.error('[UIVF12 Analysis] save as failed', error);
            showToast(window.UIVT ? window.UIVT('uiv.analysis.saveAsFail') : '另存为新脚本失败', 'error');
        }
    }

    async function deleteScript(scriptId) {
        const row = findRow(scriptId);
        if (!row) return;
        const confirmed = await openMiniDialog({
            title: window.UIVT ? window.UIVT('uiv.analysis.deleteTitle') : '删除脚本',
            message: window.UIVT ? window.UIVT('uiv.analysis.deleteConfirm', { name: row.name }) : `确定删除脚本 [${row.name}] 吗？\n删除后会从脚本仓库中移除。`,
            confirmText: window.UIVT ? window.UIVT('uiv.analysis.deleteScript') : '删除脚本',
            danger: true
        });
        if (!confirmed) return;

        try {
            await API.delete(`/api/uiv/scripts/${encodeURIComponent(scriptId)}`);
            modifiedRows.delete(scriptId);
            expandedFilterRows.delete(scriptId);
            showToast(window.UIVT ? window.UIVT('uiv.analysis.deletedToast', { name: row.name }) : `已删除脚本：${row.name}`);
            if (window.UIVSidebar && UIVSidebar.loadSavedScripts) {
                await UIVSidebar.loadSavedScripts({ reason: 'analysis-delete' });
            }
            await loadScripts(true);
        } catch (error) {
            console.error('[UIVF12 Analysis] delete failed', error);
            showToast(window.UIVT ? window.UIVT('uiv.analysis.deleteFail') : '删除脚本失败', 'error');
        }
    }

    async function saveChanges({ closeAfterSave = false } = {}) {
        if (modifiedRows.size === 0) {
            showToast(window.UIVT ? window.UIVT('uiv.analysis.noScriptsToSave') : '没有需要保存的脚本');
            if (closeAfterSave) close({ force: true });
            return;
        }
        const changedIds = [...modifiedRows.keys()];
        const items = changedIds
            .map(id => findRow(id))
            .filter(Boolean)
            .map(buildUpdatedScript);
        try {
            await API.post('/api/uiv/scripts', { items });
            modifiedRows.clear();
            showToast(window.UIVT ? window.UIVT('uiv.analysis.savedCount', { count: items.length }) : `已保存 ${items.length} 个修改脚本`);
            if (window.UIVSidebar && UIVSidebar.loadSavedScripts) {
                await UIVSidebar.loadSavedScripts({ reason: 'analysis-save' });
            }
            await loadScripts(true);
            updateSaveButtonState();
            if (closeAfterSave) close({ force: true });
        } catch (error) {
            console.error('[UIVF12 Analysis] save failed', error);
            showToast(window.UIVT ? window.UIVT('uiv.analysis.saveFail') : '保存修改失败', 'error');
        }
    }

    async function loadScripts(forceReload = false) {
        if (!forceReload && window.UIVSidebar && UIVSidebar.getScripts && UIVSidebar.getScripts().length > 0) {
            rawScripts = UIVSidebar.getScripts();
        } else {
            const mode = API.getSourceMode('uiv_repository');
            const query = mode === 'auto' ? '' : `?mode=${encodeURIComponent(mode)}`;
            const result = await API.get(`/api/uiv/scripts${query}`);
            rawScripts = result.scripts || [];
        }
        analyzedRows = rawScripts.map(analyzeScript);
        updateCategoryFilter();
        render();
    }

    async function open() {
        const modal = document.getElementById('scriptAnalysisModal');
        if (!modal) return;
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
        await loadScripts(false);
    }

    async function close(options = {}) {
        const modal = document.getElementById('scriptAnalysisModal');
        if (!modal) return;
        if (!options.force && modifiedRows.size > 0) {
            const shouldSave = await openMiniDialog({
                title: window.UIVT ? window.UIVT('uiv.analysis.unsavedTitle') : '修改尚未保存',
                message: window.UIVT ? window.UIVT('uiv.analysis.unsavedMessage', { count: modifiedRows.size }) : `还有 ${modifiedRows.size} 个脚本修改未保存。\n保存后再关闭窗口，避免修改丢失。`,
                confirmText: window.UIVT ? window.UIVT('uiv.analysis.unsavedSaveClose') : '保存后关闭'
            });
            if (shouldSave) saveChanges({ closeAfterSave: true });
            return;
        }
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
    }

    async function reload() {
        if (modifiedRows.size > 0) {
            const confirmed = await openMiniDialog({
                title: window.UIVT ? window.UIVT('uiv.analysis.refreshTitle') : '刷新分析数据',
                message: window.UIVT ? window.UIVT('uiv.analysis.refreshMessage') : '当前有未保存修改，刷新会丢失这些修改。\n确定继续刷新吗？',
                confirmText: window.UIVT ? window.UIVT('uiv.analysis.refreshConfirm') : '继续刷新',
                danger: true
            });
            if (!confirmed) return;
        }
        modifiedRows.clear();
        if (window.UIVSidebar && UIVSidebar.loadSavedScripts) {
            await UIVSidebar.loadSavedScripts({ reason: 'analysis-reload' });
        }
        await loadScripts(true);
    }

    function refill(scriptId) {
        const row = analyzedRows.find(item => item.id === scriptId);
        if (!row) return;
        const refillScript = {
            ...row.script,
            url: row.script.url || row.url,
            originalFileName: row.script.originalFileName || row.outputName.replace(/_Latest\.csv$/, ''),
            configOptions: row.script.configOptions || row.configOptions
        };

        if (window.UIVWorkbench && window.UIVWorkbench.fillWorkbench) {
            window.UIVWorkbench.fillWorkbench(refillScript);
            showToast(UIVT('uiv.toast.filled', { name: row.name }));
        }
        close();
    }

    document.addEventListener('keydown', event => {
        if (activeDialog) {
            if (event.key === 'Escape') {
                event.preventDefault();
                cancelDialog();
            }
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey || (!activeDialog.input && !activeDialog.multi))) {
                event.preventDefault();
                confirmDialog();
            }
            return;
        }
        if (event.key === 'Escape') close();
    });

    document.addEventListener('mouseover', e => {
        const pill = e.target.closest('.analysis-pill.duplicate');
        if (pill && pill.dataset.dupKey) {
            const key = pill.dataset.dupKey;
            document.querySelectorAll(`.analysis-pill.duplicate[data-dup-key="${CSS.escape(key)}"]`).forEach(el => el.classList.add('dup-hover'));
        }
    });

    document.addEventListener('mouseout', e => {
        const pill = e.target.closest('.analysis-pill.duplicate');
        if (pill && pill.dataset.dupKey) {
            document.querySelectorAll('.analysis-pill.duplicate.dup-hover').forEach(el => el.classList.remove('dup-hover'));
        }
    });

    window.UIVScriptAnalysis = {
        open,
        close,
        reload,
        render,
        refill,
        selectRow,
        editFilter,
        editCoreObject,
        deleteFilter,
        toggleFilters,
        copyModified,
        saveAsNew,
        deleteScript,
        saveChanges,
        addMultiValue,
        removeMultiValue,
        confirmDialog,
        cancelDialog,
        copyCellText
    };
})();
