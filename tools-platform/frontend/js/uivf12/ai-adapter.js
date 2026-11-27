/**
 * uivf12/ai-adapter.js
 * AI 全网站适配器入口。结构匹配时复用成熟生成引擎，其余走通用受控模板。
 */
(function () {
    let latestAnalysis = null;
    let analyzeLogs = [];
    let keywordMatches = [];
    let keywordTimer = null;
    let analysisRevision = 0;
    let progressTimer = null;
    let progressValue = 0;
    let progressStartedAt = 0;
    let isAnalyzing = false;

    function el(id) {
        return document.getElementById(id);
    }

    function open() {
        invalidateAnalysis();
        resetProgress();
        el('uivAiAdapterOverlay').style.display = 'flex';
        el('uivAiAdapterStatus').textContent = '';
        resetAnalyzeLog(window.UIVT ? window.UIVT('uiv.aiAdapter.waitingStart') : '等待开始分析。');
        if (!el('uivAiUrl').value) el('uivAiUrl').value = el('requestUrl').value || '';
        if (!el('uivAiOpenUrl').value && window.__uivAiAdapterCurrent && window.__uivAiAdapterCurrent.openUrl) {
            el('uivAiOpenUrl').value = window.__uivAiAdapterCurrent.openUrl;
        }
        if (!el('uivAiBody').value) el('uivAiBody').value = el('jsonInput').value || '{}';
    }

    function close() {
        el('uivAiAdapterOverlay').style.display = 'none';
        closeKeywordChoice();
    }

    function invalidateAnalysis() {
        analysisRevision += 1;
        latestAnalysis = null;
        const generateButton = el('uivAiGenerateBtn');
        if (generateButton) generateButton.disabled = true;
        if (!isAnalyzing) resetProgress();
    }

    function stopProgressPulse() {
        if (progressTimer) clearInterval(progressTimer);
        progressTimer = null;
    }

    function setProgress(value, label, state = 'busy') {
        const node = el('uivAiProgress');
        const fill = el('uivAiProgressFill');
        const labelNode = el('uivAiProgressLabel');
        const valueNode = el('uivAiProgressValue');
        if (!node || !fill || !labelNode || !valueNode) return;
        progressValue = Math.max(0, Math.min(100, Number(value) || 0));
        node.className = `uiv-ai-progress ${state}`;
        if (typeof node.setAttribute === 'function') node.setAttribute('aria-valuenow', String(Math.round(progressValue)));
        fill.style.width = `${progressValue}%`;
        labelNode.textContent = label || '';
        valueNode.textContent = state === 'error' ? (window.UIVT ? window.UIVT('uiv.aiAdapter.fail') : '失败') : `${Math.round(progressValue)}%`;
        if (typeof node.querySelectorAll === 'function') {
            const steps = [...node.querySelectorAll('.uiv-ai-progress-steps span')];
            steps.forEach((step, index) => {
                const threshold = Number(step.dataset.threshold || 0);
                step.classList.toggle('completed', progressValue >= threshold || state === 'ok');
                step.classList.toggle('active', state === 'busy' && progressValue < threshold && (index === 0 || progressValue >= Number(steps[index - 1].dataset.threshold || 0)));
            });
        }
    }

    function resetProgress() {
        stopProgressPulse();
        progressValue = 0;
        setProgress(0, window.UIVT ? window.UIVT('uiv.aiAdapter.waitingStart') : '等待开始分析', 'idle');
    }

    function startProgressPulse() {
        stopProgressPulse();
        progressStartedAt = Date.now();
        progressTimer = setInterval(() => {
            const elapsed = Date.now() - progressStartedAt;
            const ceiling = elapsed < 5000 ? 52 : (elapsed < 15000 ? 72 : 84);
            if (progressValue < ceiling) {
                const label = elapsed < 5000
                    ? (window.UIVT ? window.UIVT('uiv.aiAdapter.pulseSample') : '正在抽样并准备模型输入…')
                    : (elapsed < 15000
                        ? (window.UIVT ? window.UIVT('uiv.aiAdapter.pulseModel') : 'AI 正在分析请求与响应结构…')
                        : (window.UIVT ? window.UIVT('uiv.aiAdapter.pulseWait') : '模型仍在分析，正在耐心等待…'));
                setProgress(Math.min(ceiling, progressValue + Math.max(0.7, (ceiling - progressValue) * 0.08)), label, 'busy');
            }
        }, 650);
    }

    async function parseFetch() {
        try {
            const source = el('uivAiFetchSource').value.trim();
            if (!source) throw new Error(window.UIVT ? window.UIVT('uiv.aiAdapter.fetchSourceEmpty') : '请先粘贴 Copy as fetch 内容');
            setStatus(window.UIVT ? window.UIVT('uiv.aiAdapter.parsingFetch') : '正在安全解析 fetch 请求…', 'busy');
            el('uivAiParseFetchBtn').disabled = true;
            const result = await API.post('/api/uiv-ai-adapter/parse-fetch', { source });
            const parsed = result.parsed || {};
            el('uivAiUrl').value = parsed.url || '';
            el('uivAiMethod').value = parsed.method || 'POST';
            el('uivAiBodyType').value = parsed.bodyType || (parsed.method === 'GET' ? 'none' : 'json');
            el('uivAiHeaders').value = JSON.stringify(parsed.headers || {}, null, 4);
            el('uivAiBody').value = JSON.stringify(parsed.requestBody || {}, null, 4);
            el('uivAiCredentials').value = parsed.credentials || 'include';
            invalidateAnalysis();
            const sensitive = result.sensitiveHeaderNames || [];
            const parsedLabel = window.UIVT ? window.UIVT('uiv.aiAdapter.parsed') : '已解析：';
            const headersCountLabel = window.UIVT ? window.UIVT('uiv.aiAdapter.headerCount', { count: Object.keys(parsed.headers || {}).length }) : `${Object.keys(parsed.headers || {}).length} 个请求头`;
            const warningText = sensitive.length ? `<br><span class="warn">${window.UIVT ? window.UIVT('uiv.aiAdapter.sensitiveHeadersWarning', { headers: sensitive.map(escapeHtml).join('、') }) : `发现鉴权请求头：${sensitive.map(escapeHtml).join('、')}，将原样发送给 AI 用于判断鉴权方式。`}</span>` : '';
            el('uivAiFetchSummary').innerHTML = `
                <b>${parsedLabel}</b>${escapeHtml(parsed.method)} · ${escapeHtml(parsed.url)}
                · ${headersCountLabel}
                ${warningText}`;
            setStatus(window.UIVT ? window.UIVT('uiv.aiAdapter.fetchParsed') : 'fetch 已解析。粘贴响应后即可让 AI 分析。', 'ok');
        } catch (error) {
            setStatus(error.message || 'Copy as fetch 解析失败', 'error');
        } finally {
            el('uivAiParseFetchBtn').disabled = false;
        }
    }

    function parseJson(id, label, fallback) {
        const raw = el(id).value.trim();
        if (!raw && fallback !== undefined) return fallback;
        try {
            return JSON.parse(raw);
        } catch (error) {
            throw new Error(formatJsonParseError(label, raw, error));
        }
    }

    function formatJsonParseError(label, raw, error) {
        const message = error && error.message ? error.message : 'JSON 解析失败';
        const positionMatch = message.match(/position\s+(\d+)/i);
        const position = positionMatch ? Number(positionMatch[1]) : -1;
        let location = '';
        let snippet = '';
        if (Number.isFinite(position) && position >= 0) {
            const before = raw.slice(0, position);
            const line = before.split('\n').length;
            const column = before.length - before.lastIndexOf('\n');
            location = `，大约在第 ${line} 行第 ${column} 列`;
            const start = Math.max(0, position - 70);
            const end = Math.min(raw.length, position + 90);
            snippet = `\n附近内容：${raw.slice(start, end).replace(/\s+/g, ' ').trim()}`;
        }
        return `${label}不是合法 JSON${location}。${message}${snippet}`;
    }

    function normalizeOptionalUrl(raw, label) {
        const value = String(raw || '').trim();
        if (!value) return '';
        try {
            const parsed = new URL(value);
            if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
            return parsed.toString();
        } catch (error) {
            throw new Error(`${label}不是合法 HTTP/HTTPS URL`);
        }
    }

    function requestInput() {
        const method = el('uivAiMethod').value;
        const keyword = el('uivAiResponseKeyword').value.trim();
        if (keyword) ensureKeywordFocus();
        return {
            url: normalizeOptionalUrl(el('uivAiUrl').value, '请求 URL'),
            openUrl: normalizeOptionalUrl(el('uivAiOpenUrl').value, '抓取前打开页面 URL'),
            method,
            bodyType: method === 'GET' ? 'none' : el('uivAiBodyType').value,
            paginationPolicy: el('uivAiPaginationPolicy').value,
            credentials: el('uivAiCredentials').value,
            headers: parseJson('uivAiHeaders', '请求头', {}),
            requestBody: method === 'GET' ? parseJson('uivAiBody', '请求负载', {}) : parseJson('uivAiBody', '请求负载'),
            responseSample: parseJson('uivAiResponse', '响应样本'),
            secondResponseSample: parseJson('uivAiSecondResponse', '第二页响应样本', null),
            responseFocusKeyword: keyword,
            responseFocusPath: el('uivAiResponseFocusPath').value.trim(),
            authHint: {
                strategy: el('uivAiAuthStrategy').value,
                sourceKey: el('uivAiAuthSourceKey').value.trim(),
                valuePath: el('uivAiAuthValuePath').value.trim(),
                header: el('uivAiAuthHeader').value.trim(),
                prefix: el('uivAiAuthPrefix').value
            }
        };
    }

    function setStatus(message, type) {
        const node = el('uivAiAdapterStatus');
        node.textContent = message || '';
        node.className = `uiv-ai-status ${type || ''}`;
    }

    function resetAnalyzeLog(message) {
        analyzeLogs = [];
        renderAnalyzeLog();
        if (message) addAnalyzeLog(message, 'info');
    }

    function addAnalyzeLog(message, type) {
        const last = analyzeLogs[analyzeLogs.length - 1];
        if (last && last.message === message && last.type === (type || 'info')) return;
        analyzeLogs.push({
            message,
            type: type || 'info',
            time: new Date().toLocaleTimeString('zh-CN', { hour12: false })
        });
        if (analyzeLogs.length > 12) analyzeLogs = analyzeLogs.slice(-12);
        renderAnalyzeLog();
    }

    function renderAnalyzeLog() {
        const node = el('uivAiAdapterLog');
        if (!node) return;
        node.innerHTML = analyzeLogs.map(item => (
            `<div class="${escapeHtml(item.type)}"><span>${escapeHtml(item.time)}</span>${escapeHtml(item.message)}</div>`
        )).join('');
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[char]));
    }

    function pathToString(path) {
        return (path || []).map(item => String(item)).join('.');
    }

    function getAtPath(value, path) {
        if (!path) return value;
        return String(path).replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1')
            .split('.')
            .filter(Boolean)
            .reduce((current, key) => current == null ? undefined : current[key], value);
    }

    function valuePreview(value) {
        try {
            return JSON.stringify(value, null, 2).slice(0, 800);
        } catch (error) {
            return String(value).slice(0, 800);
        }
    }

    function nearestArrayAncestor(ancestors) {
        for (let index = ancestors.length - 1; index >= 0; index--) {
            if (ancestors[index].type === 'array') return ancestors[index].path;
        }
        return null;
    }

    function addKeywordMatch(matches, match) {
        const key = `${match.focusPath}::${match.matchPath}`;
        if (matches.some(item => `${item.focusPath}::${item.matchPath}` === key)) return;
        matches.push(match);
    }

    function findKeywordMatches(value, keyword) {
        const needle = String(keyword || '').trim().toLowerCase();
        if (!needle) return [];
        const matches = [];
        const maxMatches = 80;
        function visit(current, path, ancestors) {
            if (matches.length >= maxMatches) return;
            if (Array.isArray(current)) {
                current.slice(0, 500).forEach((child, index) => {
                    visit(child, path.concat(index), ancestors.concat([{ path, type: 'array' }]));
                });
                return;
            }
            if (current && typeof current === 'object') {
                Object.entries(current).slice(0, 1000).forEach(([key, child]) => {
                    if (matches.length >= maxMatches) return;
                    const childPath = path.concat(key);
                    const keyHit = key.toLowerCase().includes(needle);
                    if (keyHit) {
                        const childIsGroup = child && typeof child === 'object';
                        const focusPath = childIsGroup ? childPath : (nearestArrayAncestor(ancestors) || path);
                        addKeywordMatch(matches, {
                            matchType: '字段名',
                            matchText: key,
                            matchPath: pathToString(childPath),
                            focusPath: pathToString(focusPath),
                            preview: valuePreview(getAtPath(value, pathToString(focusPath)))
                        });
                    }
                    visit(child, childPath, ancestors.concat([{ path, type: 'object' }]));
                });
                return;
            }
            const text = String(current ?? '');
            if (text && text.toLowerCase().includes(needle)) {
                const arrayPath = nearestArrayAncestor(ancestors);
                const focusPath = arrayPath || path.slice(0, -1);
                addKeywordMatch(matches, {
                    matchType: '字段值',
                    matchText: text.slice(0, 120),
                    matchPath: pathToString(path),
                    focusPath: pathToString(focusPath),
                    preview: valuePreview(getAtPath(value, pathToString(focusPath)))
                });
            }
        }
        visit(value, [], []);
        return matches;
    }

    function setKeywordSummary(message, type) {
        const node = el('uivAiKeywordSummary');
        node.textContent = message || '';
        node.className = `uiv-ai-keyword-summary ${type || ''}`;
    }

    function clearKeywordFocus() {
        keywordMatches = [];
        el('uivAiResponseFocusPath').value = '';
    }

    function evaluateKeywordFocus(options = {}) {
        const keyword = el('uivAiResponseKeyword').value.trim();
        clearKeywordFocus();
        closeKeywordChoice();
        if (!keyword) {
            setKeywordSummary(window.UIVT ? window.UIVT('uiv.aiAdapter.keywordSummary') : '不填写关键词时，AI 会分析完整响应样本。', '');
            return;
        }
        let responseJson;
        try {
            responseJson = parseJson('uivAiResponse', '响应样本');
        } catch (error) {
            setKeywordSummary(window.UIVT ? window.UIVT('uiv.aiAdapter.keywordNeedValidJson') : '请先粘贴合法响应 JSON，才能查找关键词。', 'error');
            return;
        }
        keywordMatches = findKeywordMatches(responseJson, keyword);
        if (!keywordMatches.length) {
            setKeywordSummary(window.UIVT ? window.UIVT('uiv.aiAdapter.keywordNotFound', { keyword }) : `响应样本中未找到关键词“${keyword}”。`, 'error');
            return;
        }
        if (keywordMatches.length === 1) {
            selectKeywordMatch(0, { silent: true });
            return;
        }
        setKeywordSummary(window.UIVT ? window.UIVT('uiv.aiAdapter.keywordFoundMultiple', { count: keywordMatches.length, keyword }) : `找到 ${keywordMatches.length} 处关键词“${keyword}”，请选择要抓取的数据片段。`, 'warn');
        if (options.showChoice !== false) showKeywordChoice();
    }

    function ensureKeywordFocus() {
        const keyword = el('uivAiResponseKeyword').value.trim();
        if (!keyword) return;
        if (el('uivAiResponseFocusPath').value.trim()) return;
        evaluateKeywordFocus({ showChoice: true });
        if (!el('uivAiResponseFocusPath').value.trim()) {
            throw new Error('请先选择关键词所在的数据片段，再进行 AI 分析。');
        }
    }

    function selectKeywordMatch(index, options = {}) {
        const match = keywordMatches[index];
        if (!match) return;
        const rootLabel = window.UIVT ? window.UIVT('uiv.aiAdapter.rootNode') : '(根节点)';
        el('uivAiResponseFocusPath').value = match.focusPath;
        setKeywordSummary(window.UIVT ? window.UIVT('uiv.aiAdapter.keywordFocused', {
            focus: match.focusPath || rootLabel,
            hit: match.matchPath || rootLabel
        }) : `已聚焦：${match.focusPath || '(根节点)'}；命中位置：${match.matchPath || '(根节点)'}`, 'ok');
        if (!options.silent) closeKeywordChoice();
    }

    function showKeywordChoice() {
        const list = el('uivAiKeywordChoiceList');
        const rootLabel = window.UIVT ? window.UIVT('uiv.aiAdapter.rootNode') : '(根节点)';
        const hitLabel = window.UIVT ? window.UIVT('uiv.aiAdapter.hitPos') : '命中位置';
        const focusLabel = window.UIVT ? window.UIVT('uiv.aiAdapter.focusSegment') : '聚焦片段';
        list.innerHTML = keywordMatches.map((match, index) => {
            const typeLabel = match.matchType === '字段名'
                ? (window.UIVT ? window.UIVT('uiv.aiAdapter.matchFieldName') : '字段名')
                : (window.UIVT ? window.UIVT('uiv.aiAdapter.matchFieldValue') : '字段值');
            return `
            <button class="uiv-ai-choice-item" onclick="UIVAIAdapter.selectKeywordMatch(${index})">
                <div><b>${escapeHtml(typeLabel)}</b>：${escapeHtml(match.matchText)}</div>
                <div>${hitLabel}：<code>${escapeHtml(match.matchPath || rootLabel)}</code></div>
                <div>${focusLabel}：<code>${escapeHtml(match.focusPath || rootLabel)}</code></div>
                <pre>${escapeHtml(match.preview)}</pre>
            </button>
        `; }).join('');
        el('uivAiKeywordChoiceOverlay').style.display = 'flex';
    }

    function closeKeywordChoice() {
        const node = el('uivAiKeywordChoiceOverlay');
        if (node) node.style.display = 'none';
    }

    function scheduleKeywordEvaluation() {
        clearTimeout(keywordTimer);
        keywordTimer = setTimeout(() => evaluateKeywordFocus({ showChoice: true }), 350);
    }

    async function analyze() {
        const runRevision = ++analysisRevision;
        isAnalyzing = true;
        try {
            resetAnalyzeLog();
            setProgress(7, window.UIVT ? window.UIVT('uiv.aiAdapter.validatingInput') : '正在校验输入…', 'busy');
            addAnalyzeLog(window.UIVT ? window.UIVT('uiv.aiAdapter.logLocalValidateStart') : '开始本地校验输入 JSON。');
            setStatus(window.UIVT ? window.UIVT('uiv.aiAdapter.validatingInputJson') : '正在校验输入 JSON…', 'busy');
            el('uivAiAnalyzeBtn').disabled = true;
            const input = requestInput();
            setProgress(16, window.UIVT ? window.UIVT('uiv.aiAdapter.validatedInput') : '输入校验完成，准备安全分析…', 'busy');
            addAnalyzeLog(window.UIVT ? window.UIVT('uiv.aiAdapter.logLocalValidatePass') : '本地校验通过，准备发送到后端分析。', 'ok');
            setStatus(window.UIVT ? window.UIVT('uiv.aiAdapter.sentToBackend') : '已发送到后端，正在抽样并调用 AI…', 'busy');
            startProgressPulse();
            const result = await API.post('/api/uiv-ai-adapter/analyze', input);
            stopProgressPulse();
            if (runRevision !== analysisRevision) {
                addAnalyzeLog('分析期间输入已变更，本次结果已丢弃。', 'info');
                setStatus('输入已变更，请重新点击“AI 分析并验证”。', '');
                setProgress(progressValue, '输入已变更，请重新分析', 'error');
                return;
            }
            setProgress(88, window.UIVT ? window.UIVT('uiv.aiAdapter.modelDoneVerifying') : '模型分析完成，正在验证路径…', 'busy');
            (result.logs || []).forEach(item => addAnalyzeLog(item.message || String(item), item.type || 'info'));
            addAnalyzeLog(window.UIVT ? window.UIVT('uiv.aiAdapter.backendDoneRendering') : '后端分析完成，正在渲染结果。', 'ok');
            latestAnalysis = { input, ...result };
            const validation = result.validation || {};
            const adapter = result.adapter || {};
            const generationPlan = result.generationPlan || { mode: 'generic', profile: 'GENERIC', evidence: [] };
            const sensitive = result.sanitized && result.sanitized.sensitiveHeaderNames || [];
            const focus = result.responseFocus || null;
            const arrayCandidates = result.arrayCandidates || [];
            const sampled = (result.sampleInfo || [])
                .filter(item => item && item.truncated)
                .map(item => `${escapeHtml(item.label)} ${item.originalChars} → ${item.sampledChars} 字符`);
            const authSummary = adapter.auth.strategy === 'autoProbe'
                ? `自动探测 / ${adapter.auth.header || '认证请求头'}（Cookie → localStorage → sessionStorage → 页面字段）`
                : `${adapter.auth.strategy}${adapter.auth.sourceKey ? ` / ${adapter.auth.sourceKey}` : ''}${adapter.auth.valuePath ? ` → ${adapter.auth.valuePath}` : ''}`;
            el('uivAiAdapterPreview').innerHTML = `
                <div><b>请求：</b>${escapeHtml(adapter.request.method)} · ${escapeHtml(adapter.request.bodyType)}</div>
                ${input.openUrl ? `<div><b>抓取前打开：</b>${escapeHtml(input.openUrl)}</div>` : ''}
                <div><b>认证：</b>${escapeHtml(authSummary)}</div>
                <div><b>分页：</b>${escapeHtml(adapter.pagination.type)}${adapter.pagination.requestPath ? ` / ${escapeHtml(adapter.pagination.requestPath)}` : ''}${adapter.pagination.nextCursorPath ? ` → ${escapeHtml(adapter.pagination.nextCursorPath)}` : ''}</div>
                <div><b>数据路径：</b>${escapeHtml(adapter.response.rowsPath || '(根数组)')} · ${escapeHtml(adapter.response.rowMode || 'object')}</div>
                <div><b>生成引擎：</b>${generationPlan.mode === 'native-hybrid' ? `${escapeHtml(generationPlan.profile)} 成熟模板 + AI 适配` : '通用 AI 受控模板'}</div>
                ${generationPlan.mode === 'native-hybrid' ? `<div class="note"><b>匹配置信度：</b>${Math.round(Number(generationPlan.confidence || 0) * 100)}%${generationPlan.nativeHost ? ' · 官方站点完整能力' : ' · 同结构安全复用'}</div>` : ''}
                ${(generationPlan.evidence || []).map(item => `<div class="note">• ${escapeHtml(item)}</div>`).join('')}
                <div><b>样本验证：</b>${validation.rowCount || 0} 行，${(validation.fields || []).length} 个字段</div>
                ${arrayCandidates.length ? `<div class="note"><b>候选数据数组：</b>确定性扫描到 ${arrayCandidates.length} 处，最终采用 ${escapeHtml(adapter.response.rowsPath || '(根数组)')}</div>` : ''}
                ${focus ? `<div class="note"><b>关键词聚焦：</b>${escapeHtml(focus.keyword || '')} / ${escapeHtml(focus.path || '(根节点)')}</div>` : ''}
                ${sampled.length ? `<div class="note"><b>已自动抽样：</b>${sampled.join('；')}</div>` : ''}
                ${sensitive.length ? `<div class="warn"><b>鉴权请求头（原样发送）：</b>${sensitive.map(escapeHtml).join('、')}</div>` : ''}
                ${(adapter.notes || []).map(note => `<div class="note">• ${escapeHtml(note)}</div>`).join('')}
                <details><summary>预览前 5 行</summary><pre>${escapeHtml(JSON.stringify(validation.previewRows || [], null, 2))}</pre></details>`;
            el('uivAiGenerateBtn').disabled = false;
            setProgress(100, result.deterministicFallback ? (window.UIVT ? window.UIVT('uiv.aiAdapter.analyzeDoneFallback') : '分析完成（已启用安全兜底）') : (window.UIVT ? window.UIVT('uiv.aiAdapter.analyzeDoneOk') : '分析与路径验证完成'), 'ok');
            setStatus(window.UIVT ? window.UIVT('uiv.aiAdapter.statusAnalyzePassed') : '分析与样本验证通过，可以生成脚本。', 'ok');
        } catch (error) {
            stopProgressPulse();
            latestAnalysis = null;
            el('uivAiGenerateBtn').disabled = true;
            if (error.body && Array.isArray(error.body.logs)) {
                error.body.logs.forEach(item => addAnalyzeLog(item.message || String(item), item.type || 'info'));
            }
            if (error.body && error.body.stage) addAnalyzeLog(`后端阶段失败：${error.body.stage}`, 'error');
            addAnalyzeLog(error.message || 'AI 分析失败', 'error');
            setProgress(progressValue || 8, '分析失败，请查看下方原因', 'error');
            setStatus(error.message || 'AI 分析失败', 'error');
        } finally {
            stopProgressPulse();
            isAnalyzing = false;
            el('uivAiAnalyzeBtn').disabled = false;
        }
    }

    function js(value) {
        return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    }

    function getAuthProbeRuntimeSource() {
        if (!window.UIVAuthProbe || typeof window.UIVAuthProbe.getRuntimeSource !== 'function') {
            throw new Error('认证来源探测模块未加载，请刷新页面后重试');
        }
        return window.UIVAuthProbe.getRuntimeSource();
    }

    function getSafeRuntimeHeaders(state) {
        const safeHeaders = {};
        const sensitiveNames = new Set((state.sanitized && state.sanitized.sensitiveHeaderNames || []).map(name => name.toLowerCase()));
        const forbiddenNames = new Set(['host', 'content-length', 'origin', 'referer', 'connection', 'accept-encoding', 'user-agent']);
        Object.entries(state.input.headers || {}).forEach(([key, value]) => {
            const lowerKey = key.toLowerCase();
            const validHeader = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(key)
                && !['__proto__', 'prototype', 'constructor'].includes(lowerKey);
            if (validHeader && !sensitiveNames.has(lowerKey) && !forbiddenNames.has(lowerKey)) safeHeaders[key] = value;
        });
        return safeHeaders;
    }

    function buildRuntimeCore(state) {
        const { input, adapter } = state;
        const fileName = (el('uivAiFileName').value.trim() || 'AI_适配抓取_Latest').replace(/\.csv$/i, '') + '.csv';
        const safeHeaders = getSafeRuntimeHeaders(state);

        return `
        const requestUrl = ${js(input.url)};
        const adapter = ${js(adapter)};
        const basePayload = ${js(input.requestBody || {})};
        const fetchHeaders = ${js(safeHeaders)};
        const maxPages = 200;
        const requestTimeoutMs = 45000;
        const maxRetries = 2;

${getAuthProbeRuntimeSource()}

        function normalizePath(path) {
            return String(path || "").replace(/^\\$\\.?/, "").replace(/\\[(\\d+)\\]/g, ".$1");
        }
        function pathKeys(path) {
            const keys = normalizePath(path).split(".").filter(Boolean);
            const blocked = new Set(["__proto__", "prototype", "constructor"]);
            if (keys.some(key => blocked.has(String(key).toLowerCase()))) throw new Error("数据路径包含不安全字段");
            return keys;
        }
        function getAtPath(value, path) {
            if (!path) return value;
            return pathKeys(path).reduce((current, key) => {
                if (current == null || !Object.prototype.hasOwnProperty.call(Object(current), key)) return undefined;
                return current[key];
            }, value);
        }
        function setAtPath(value, path, nextValue) {
            const keys = pathKeys(path);
            if (!keys.length) return;
            let current = value;
            keys.slice(0, -1).forEach(key => {
                if (!Object.prototype.hasOwnProperty.call(Object(current), key) || !current[key] || typeof current[key] !== "object") current[key] = {};
                current = current[key];
            });
            current[keys[keys.length - 1]] = nextValue;
        }
        function normalizeCell(value) {
            if (value === null || value === undefined) return "";
            return typeof value === "object" ? JSON.stringify(value) : value;
        }
        function normalizeRows(rows, rowMode) {
            if (!Array.isArray(rows)) return null;
            if (rowMode === "value") {
                if (rows.some(row => row !== null && typeof row === "object")) return null;
                return rows.map(value => ({ value }));
            }
            if (rowMode === "array") {
                if (rows.some(row => !Array.isArray(row))) return null;
                return rows.map(row => Object.fromEntries(row.map((value, index) => ["column_" + (index + 1), value])));
            }
            if (rows.some(row => !row || Array.isArray(row) || typeof row !== "object")) return null;
            return rows;
        }
        function encodeForm(payload) {
            const params = new URLSearchParams();
            Object.entries(payload || {}).forEach(([key, value]) => {
                if (Array.isArray(value)) value.forEach(item => params.append(key, item === null ? "" : String(item)));
                else if (value && typeof value === "object") params.append(key, JSON.stringify(value));
                else params.append(key, value === null || value === undefined ? "" : String(value));
            });
            return params.toString();
        }
        function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
        async function fetchWithRetry(url, options) {
            let lastError = null;
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);
                let response;
                try {
                    response = await fetch(url, { ...options, signal: controller.signal });
                } catch (error) {
                    lastError = error && error.name === "AbortError"
                        ? new Error("请求超时（" + Math.round(requestTimeoutMs / 1000) + " 秒）")
                        : error;
                    if (attempt < maxRetries) { await delay(700 * (attempt + 1)); continue; }
                    throw lastError;
                } finally {
                    clearTimeout(timeoutId);
                }
                if (response.ok) return response;
                const retryable = response.status === 429 || [502, 503, 504].includes(response.status);
                if (retryable && attempt < maxRetries) {
                    const retryAfter = Number(response.headers.get("retry-after"));
                    await delay(Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 5000) : 700 * (attempt + 1));
                    continue;
                }
                const errorText = (await response.text()).replace(/\s+/g, " ").slice(0, 500);
                throw new Error("HTTP " + response.status + " " + response.statusText + (errorText ? "：" + errorText : ""));
            }
            throw lastError || new Error("请求失败");
        }
        async function readJsonResponse(response) {
            const text = await response.text();
            try { return JSON.parse(text); }
            catch (_) {
                const contentType = response.headers.get("content-type") || "未知类型";
                throw new Error("响应不是合法 JSON（" + contentType + "），可能已跳转登录页或接口返回 HTML：" + text.replace(/\s+/g, " ").slice(0, 300));
            }
        }

        const resolvedAdapterAuth = uivResolveAdapterAuth(adapter.auth);
        if (resolvedAdapterAuth) fetchHeaders[resolvedAdapterAuth.header] = resolvedAdapterAuth.value;
        const hasContentType = Object.keys(fetchHeaders).some(name => name.toLowerCase() === "content-type");
        if (!hasContentType && adapter.request.bodyType === "json") fetchHeaders["content-type"] = "application/json;charset=UTF-8";
        if (!hasContentType && adapter.request.bodyType === "form") fetchHeaders["content-type"] = "application/x-www-form-urlencoded;charset=UTF-8";

        const allRows = [];
        const pageFingerprints = new Set();
        let cursor = adapter.pagination.type === "cursor"
            ? String(adapter.pagination.start || "")
            : Number(adapter.pagination.start);
        if (adapter.pagination.type !== "cursor" && !Number.isFinite(cursor)) cursor = adapter.pagination.type === "offset" ? 0 : 1;
        for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
            const payload = JSON.parse(JSON.stringify(basePayload));
            let pageUrl = requestUrl;
            const shouldWriteCursor = adapter.pagination.type !== "none" && (adapter.pagination.type !== "cursor" || cursor !== "");
            if (shouldWriteCursor) {
                if (adapter.request.method === "GET") {
                    const parsed = new URL(pageUrl, location.href);
                    parsed.searchParams.set(adapter.pagination.requestPath, String(cursor));
                    pageUrl = parsed.toString();
                } else {
                    setAtPath(payload, adapter.pagination.requestPath, cursor);
                }
            }
            const options = {
                method: adapter.request.method,
                headers: fetchHeaders,
                credentials: adapter.request.credentials
            };
            if (adapter.request.method !== "GET") {
                if (adapter.request.bodyType === "json") options.body = JSON.stringify(payload);
                if (adapter.request.bodyType === "form") options.body = encodeForm(payload);
            }
            const response = await fetchWithRetry(pageUrl, options);
            const data = await readJsonResponse(response);
            const rawRows = getAtPath(data, adapter.response.rowsPath);
            if (!Array.isArray(rawRows)) {
                const graphQlError = Array.isArray(data && data.errors) && data.errors.length
                    ? "；GraphQL errors：" + JSON.stringify(data.errors).slice(0, 500)
                    : "";
                throw new Error("响应路径未提取到数组：" + (adapter.response.rowsPath || "(根节点)") + graphQlError);
            }
            if (!rawRows.length) break;
            const rows = normalizeRows(rawRows, adapter.response.rowMode || "object");
            if (!rows) throw new Error("响应数据行类型与 rowMode=" + (adapter.response.rowMode || "object") + " 不一致");
            const fingerprint = JSON.stringify([rows.length, rows[0], rows[rows.length - 1]]).slice(0, 4000);
            if (pageFingerprints.has(fingerprint)) {
                console.warn("检测到重复分页数据，已停止，避免无限循环。");
                break;
            }
            pageFingerprints.add(fingerprint);
            allRows.push(...rows);

            if (adapter.pagination.type === "none") break;
            const total = adapter.response.totalPath ? Number(getAtPath(data, adapter.response.totalPath)) : NaN;
            if (Number.isFinite(total) && allRows.length >= total) break;
            const hasMoreValue = adapter.pagination.hasMorePath ? getAtPath(data, adapter.pagination.hasMorePath) : undefined;
            if (hasMoreValue === false || hasMoreValue === 0 || String(hasMoreValue).toLowerCase() === "false") break;
            if (adapter.pagination.type === "cursor") {
                const nextCursor = getAtPath(data, adapter.pagination.nextCursorPath);
                if (nextCursor === undefined || nextCursor === null || nextCursor === "") break;
                const nextCursorText = String(nextCursor);
                if (nextCursorText === String(cursor)) {
                    console.warn("下一页游标未变化，已停止。");
                    break;
                }
                cursor = nextCursorText;
                await delay(300);
                continue;
            }
            let configuredPageSize = NaN;
            if (adapter.pagination.pageSizePath) {
                configuredPageSize = adapter.request.method === "GET"
                    ? Number(new URL(pageUrl, location.href).searchParams.get(adapter.pagination.pageSizePath))
                    : Number(getAtPath(payload, adapter.pagination.pageSizePath));
            }
            const effectivePageSize = Number.isFinite(configuredPageSize)
                ? configuredPageSize
                : Number(adapter.pagination.pageSize);
            if (Number.isFinite(effectivePageSize) && effectivePageSize > 0 && rows.length < effectivePageSize) break;
            cursor += Number(adapter.pagination.step || 1);
            await delay(300);
        }
        if (!allRows.length) throw new Error("没有提取到可导出的数据");

        const headers = [];
        allRows.forEach(row => {
            if (row && typeof row === "object" && !Array.isArray(row)) {
                Object.keys(row).forEach(key => { if (!headers.includes(key)) headers.push(key); });
            }
        });
        if (!headers.length) throw new Error("数据行不是 JSON 对象，无法生成表头");
        let csvContent = String.fromCharCode(0xFEFF) + headers.map(header => '"' + String(header).replace(/"/g, '""') + '"').join(",") + String.fromCharCode(10);
        allRows.forEach(row => {
            csvContent += headers.map(header => '"' + String(normalizeCell(row[header])).replace(/"/g, '""') + '"').join(",") + String.fromCharCode(10);
        });
        let finalOutputName = ${js(fileName)};
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = finalOutputName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        return "✅ AI 适配抓取成功：" + allRows.length + " 条";`;
    }

    function buildAdapterMeta(state) {
        const auth = state.adapter && state.adapter.auth || {};
        const plan = state.generationPlan || {};
        const shouldUseNativeProbe = plan.nativeHost === true;
        return {
            generatorType: 'ai-adapter',
            adapterConfig: state.adapter,
            generationPlan: state.generationPlan || { mode: 'generic', profile: 'GENERIC' },
            openUrl: state.input.openUrl || '',
            loginProbeConfig: shouldUseNativeProbe
                ? null
                : {
                    strategy: auth.strategy || 'none',
                    sourceKey: auth.sourceKey || '',
                    valuePath: auth.valuePath || '',
                    header: auth.header || '',
                    prefix: auth.prefix || ''
                }
        };
    }

    function prepareWorkbench(state, title, generationPlan = null) {
        el('requestUrl').value = state.input.url;
        el('jsonInput').value = JSON.stringify(state.input.requestBody || {}, null, 4);
        el('jsonInput').style.display = 'block';
        const viewer = el('payloadViewer');
        if (viewer) viewer.style.display = 'none';
        el('fileName').value = title;
        const triplicate = el('autoNetCareTriplicate');
        if (triplicate) triplicate.checked = false;
        if (generationPlan && generationPlan.mode === 'native-hybrid') {
            const capabilities = generationPlan.capabilities || {};
            const pagination = el('isPagination');
            if (pagination) {
                pagination.checked = state.adapter.pagination.type !== 'none' || capabilities.preferPagination === true;
            }
            if (!capabilities.allowSpecialEndpoints) {
                const forceSum = el('forceSumData');
                const autoCpc = el('autoFetchCPC');
                if (forceSum) forceSum.checked = false;
                if (autoCpc) autoCpc.checked = false;
            }
        }
        window.UIVWorkbench.setParsedPayload(state.input.requestBody || {});
    }

    function generate() {
        if (!latestAnalysis) {
            setStatus(window.UIVT ? window.UIVT('uiv.aiAdapter.needAnalyzeFirst') : '请先完成 AI 分析。', 'error');
            return;
        }
        const rawTitle = (el('uivAiFileName').value.trim() || 'AI_适配抓取').replace(/\.csv$/i, '');
        const plan = latestAnalysis.generationPlan || { mode: 'generic', profile: 'GENERIC', capabilities: {} };
        const adapterMeta = buildAdapterMeta(latestAnalysis);

        if (plan.mode === 'native-hybrid' && ['DATAFAB', 'NETCARE'].includes(plan.profile)) {
            const nativeTitle = rawTitle.replace(/_Latest$/i, '') || 'AI_适配抓取';
            prepareWorkbench(latestAnalysis, nativeTitle, plan);
            window.UIVGenerator.generateScript({
                platformOverride: plan.profile,
                aiAdapter: latestAnalysis.adapter,
                headersOverride: getSafeRuntimeHeaders(latestAnalysis),
                useNativeAuth: plan.nativeHost === true,
                allowNativeSpecialEndpoints: Boolean(plan.capabilities && plan.capabilities.allowSpecialEndpoints),
                allowNativeRequestExtensions: plan.nativeHost === true,
                aiAdapterMeta: adapterMeta,
                authProbeRuntime: getAuthProbeRuntimeSource()
            });
            if (!el('codeOutput').value || !el('consoleOutput').value) {
                setStatus('成熟模板生成失败，请检查工作台输入。', 'error');
                return;
            }
            close();
            showToast(window.UIVT ? window.UIVT('uiv.aiAdapter.toastNativeSuccess', { profile: plan.profile }) : `✅ 已使用 ${plan.profile} 成熟逻辑 + AI 适配生成脚本，请先单脚本验证。`, 'success');
            return;
        }

        const core = buildRuntimeCore(latestAnalysis);
        const uivCode = `return (async function() { try {${core}\n        } catch (error) { return "❌ 报错: " + error.message; } })();`;
        const consoleCode = `(async function() { try { const result = await (async function() {${core}\n        })(); console.log(result); } catch (error) { console.error("❌ AI 适配抓取失败:", error); } })();`;
        try {
            new Function(uivCode);
            new Function(consoleCode);
        } catch (syntaxError) {
            setStatus(`生成脚本语法校验失败：${syntaxError.message}`, 'error');
            return;
        }
        prepareWorkbench(latestAnalysis, rawTitle, plan);
        el('codeOutput').value = uivCode;
        el('consoleOutput').value = consoleCode;
        window.UIVWorkbench.setCurrentTitle(rawTitle, rawTitle);
        window.__uivAiAdapterCurrent = adapterMeta;
        window.UIVAINaming?.generateForCurrentScript({ source: 'ai-generic' });
        close();
        showToast(window.UIVT ? window.UIVT('uiv.aiAdapter.toastGenericSuccess') : '✅ 通用 AI 适配脚本已生成，请先单脚本验证后再加入批量仓库。', 'success');
    }

    function refreshI18n() {
        if (el('uivAiKeywordChoiceOverlay')?.style.display === 'flex' && keywordMatches.length) {
            showKeywordChoice();
        }
        if (!isAnalyzing && progressValue === 0) {
            resetProgress();
        }
    }

    function initKeywordInputs() {
        const keywordInput = el('uivAiResponseKeyword');
        const responseInput = el('uivAiResponse');
        if (keywordInput) keywordInput.addEventListener('input', scheduleKeywordEvaluation);
        if (responseInput) responseInput.addEventListener('input', () => {
            if (el('uivAiResponseKeyword').value.trim()) scheduleKeywordEvaluation();
        });
        [
            'uivAiFetchSource', 'uivAiUrl', 'uivAiOpenUrl', 'uivAiMethod', 'uivAiBodyType', 'uivAiPaginationPolicy', 'uivAiCredentials',
            'uivAiHeaders', 'uivAiBody', 'uivAiResponse', 'uivAiSecondResponse',
            'uivAiResponseKeyword', 'uivAiAuthStrategy', 'uivAiAuthSourceKey',
            'uivAiAuthValuePath', 'uivAiAuthHeader', 'uivAiAuthPrefix'
        ].forEach(id => {
            const input = el(id);
            if (!input) return;
            input.addEventListener('input', invalidateAnalysis);
            input.addEventListener('change', invalidateAnalysis);
        });
    }

    initKeywordInputs();

    const methodSelect = el('uivAiMethod');
    if (methodSelect) methodSelect.addEventListener('change', () => {
        if (methodSelect.value === 'GET') el('uivAiBodyType').value = 'none';
        else if (el('uivAiBodyType').value === 'none') el('uivAiBodyType').value = 'json';
    });

    window.UIVAIAdapter = {
        open,
        close,
        parseFetch,
        analyze,
        generate,
        selectKeywordMatch,
        closeKeywordChoice,
        refreshI18n
    };
})();
