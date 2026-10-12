/**
 * uivf12/ai-naming.js - 生成完成后的中英文脚本自动命名
 */
(function () {
    let requestSequence = 0;
    let pendingRequest = Promise.resolve(null);
    let hasSavedCurrent = false;
    let isRequestInProgress = false;

    function t(key) {
        return typeof window.UIVT === 'function' ? window.UIVT(key) : key;
    }

    function collectPayloadSummary(payload) {
        const keys = [];
        const semanticValues = [];
        const seenKeys = new Set();
        const seenValues = new Set();
        const sensitiveKey = /token|secret|password|cookie|authorization|csrf|xsrf|session/i;
        const semanticKey = /(?:^|_)(?:page|component|table|board|report|sheet|metric|module|resource|service)(?:_?name|_?title)?$/i;
        let visited = 0;

        function walk(value, depth) {
            if (!value || typeof value !== 'object' || depth > 6 || visited > 320) return;
            visited += 1;
            if (Array.isArray(value)) {
                value.slice(0, 4).forEach(item => walk(item, depth + 1));
                return;
            }
            Object.entries(value).slice(0, 80).forEach(([key, child]) => {
                if (!seenKeys.has(key) && !sensitiveKey.test(key) && keys.length < 80) {
                    seenKeys.add(key);
                    keys.push(key);
                }
                if (
                    semanticValues.length < 30 &&
                    semanticKey.test(key) &&
                    typeof child === 'string' &&
                    child.trim() &&
                    child.length <= 120 &&
                    !sensitiveKey.test(key)
                ) {
                    const summary = `${key}=${child.trim()}`;
                    if (!seenValues.has(summary)) {
                        seenValues.add(summary);
                        semanticValues.push(summary);
                    }
                }
                walk(child, depth + 1);
            });
        }

        walk(payload, 0);
        return { payloadKeys: keys, semanticValues };
    }

    function getEndpoint() {
        const raw = document.getElementById('requestUrl')?.value.trim() || '';
        try {
            const url = new URL(raw);
            return `${url.origin}${url.pathname}`;
        } catch (_) {
            return raw.slice(0, 500);
        }
    }

    function detectPlatform(endpoint) {
        const lower = String(endpoint || '').toLowerCase();
        if (lower.includes('datafab')) return 'DataFab';
        if (lower.includes('netcare')) return 'NetCare';
        return 'Custom API';
    }

    function getElements() {
        return {
            input: document.getElementById('fileName'),
            guide: document.querySelector('.file-name-guide'),
            badge: document.querySelector('.file-name-guide-badge'),
            title: document.querySelector('.file-name-guide-title'),
            text: document.querySelector('.file-name-guide-text'),
            suggestions: document.getElementById('fileNameAiSuggestions'),
            zhButton: document.getElementById('fileNameAiZh'),
            enButton: document.getElementById('fileNameAiEn')
        };
    }

    function setGuideState(state, title, text) {
        const elements = getElements();
        elements.guide?.classList.toggle('ai-naming-loading', state === 'loading');
        elements.guide?.classList.toggle('ai-naming-ready', state === 'ready');
        elements.guide?.classList.toggle('ai-naming-error', state === 'error');
        if (elements.badge) {
            elements.badge.textContent = state === 'loading'
                ? t('uiv.input.fileAiBadgeLoading')
                : t('uiv.input.fileAiBadge');
        }
        if (elements.title) elements.title.textContent = title;
        if (elements.text) elements.text.textContent = text;
    }

    function applyCandidate(name) {
        const input = document.getElementById('fileName');
        if (!input || !name) return;
        input.value = name;
        input.dataset.aiNamed = 'true';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('.file-name-glow')?.classList.add('ai-name-applied');
        window.setTimeout(() => document.querySelector('.file-name-glow')?.classList.remove('ai-name-applied'), 1100);
    }

    function showSuggestions(zhName, enName) {
        const elements = getElements();
        if (!elements.suggestions || !elements.zhButton || !elements.enButton) return;
        elements.zhButton.dataset.name = zhName;
        elements.zhButton.querySelector('span').textContent = zhName;
        elements.zhButton.title = t('uiv.input.fileAiUseZh');
        elements.enButton.dataset.name = enName;
        elements.enButton.querySelector('span').textContent = enName;
        elements.enButton.title = t('uiv.input.fileAiUseEn');
        elements.suggestions.hidden = false;
    }

    async function requestName(source) {
        const sequence = ++requestSequence;
        const elements = getElements();
        if (!elements.input || !document.getElementById('codeOutput')?.value) return null;
        const startingValue = elements.input.value.trim();
        const payload = window.UIVWorkbench?.getParsedPayload?.() || null;
        const summary = collectPayloadSummary(payload);
        const endpoint = getEndpoint();

        if (elements.suggestions) elements.suggestions.hidden = true;
        setGuideState('loading', t('uiv.input.fileAiAnalyzing'), t('uiv.input.fileAiAnalyzingHint'));
        isRequestInProgress = true;

        try {
            const result = await API.post('/api/uiv-ai-adapter/name-script', {
                currentTitle: window.UIVWorkbench?.getCurrentTitle?.() || startingValue,
                inputName: startingValue,
                source: source || 'generated',
                platform: detectPlatform(endpoint),
                endpoint,
                payloadKeys: summary.payloadKeys,
                semanticValues: summary.semanticValues
            });
            if (sequence !== requestSequence) return null;
            const zhName = String(result.zhName || '').trim();
            const enName = String(result.enName || '').trim();
            if (!zhName || !enName) throw new Error('AI naming result is incomplete');

            const combinedName = `${zhName}_${enName}`;
            const userEditedWhileWaiting = elements.input.value.trim() !== startingValue;
            if (!userEditedWhileWaiting && !hasSavedCurrent) {
                applyCandidate(combinedName);
            }
            showSuggestions(zhName, enName);
            setGuideState(
                'ready',
                hasSavedCurrent
                    ? (t('uiv.input.fileAiSuggestionsReady') || 'AI建议名称已就绪')
                    : (userEditedWhileWaiting ? t('uiv.input.fileAiSuggestionsReady') : t('uiv.input.fileAiApplied')),
                hasSavedCurrent
                    ? `${t('uiv.input.fileAiSuggestionsReady') || 'AI候选'}: ${combinedName}`
                    : (userEditedWhileWaiting ? t('uiv.input.fileAiKeptManual') : combinedName)
            );
            return { zhName, enName, combinedName, applied: !userEditedWhileWaiting && !hasSavedCurrent };
        } catch (error) {
            if (sequence !== requestSequence) return null;
            console.warn('[UIVF12 AI Naming] unavailable:', error);
            setGuideState('error', t('uiv.input.fileAiUnavailable'), t('uiv.input.fileAiUnavailableHint'));
            return null;
        } finally {
            if (sequence === requestSequence) {
                isRequestInProgress = false;
            }
        }
    }

    function generateForCurrentScript(options = {}) {
        hasSavedCurrent = false;
        pendingRequest = requestName(options.source).catch(() => null);
        return pendingRequest;
    }

    function waitForPending() {
        return pendingRequest.catch(() => null);
    }

    function markSaved() {
        hasSavedCurrent = true;
    }

    function isPending() {
        return Boolean(isRequestInProgress);
    }

    function reset() {
        requestSequence += 1;
        hasSavedCurrent = false;
        isRequestInProgress = false;
        pendingRequest = Promise.resolve(null);
        const elements = getElements();
        if (elements.suggestions) elements.suggestions.hidden = true;
        elements.guide?.classList.remove('ai-naming-loading', 'ai-naming-ready', 'ai-naming-error');
        if (elements.badge) elements.badge.textContent = t('uiv.input.fileGuideBadge');
        if (elements.title) elements.title.textContent = t('uiv.input.fileGuideTitle');
        if (elements.text) elements.text.textContent = t('uiv.input.fileGuideText');
    }

    window.applyUIVAiNameCandidate = function (button) {
        applyCandidate(button?.dataset?.name || '');
    };

    window.UIVAINaming = {
        generateForCurrentScript,
        waitForPending,
        markSaved,
        isPending,
        reset
    };
})();
