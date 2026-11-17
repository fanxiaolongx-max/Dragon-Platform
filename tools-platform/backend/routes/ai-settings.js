const express = require('express');
const router = express.Router();
const repo = require('../models/ai-settings-repository');
const aiProviderClient = require('../models/ai-provider-client');
const aiUsageRepo = require('../models/ai-usage-repository');
const { redactText, redactValue } = require('../models/ai-sensitive-data');

const TEST_TIMEOUT_MS = 30000;

function expectedEndpointForSettings(settings = {}) {
    const provider = aiProviderClient.normalizeProvider(settings.provider);
    const base = aiProviderClient.getBaseUrl(settings);
    if (provider === 'anthropic') return `${base}/messages`;
    if (provider === 'gemini') return `${base}/models/${encodeURIComponent(settings.model || 'gemini-2.5-flash')}:generateContent`;
    return `${base}/chat/completions`;
}

function prettifyRawDetail(rawText = '', secrets = []) {
    const text = String(rawText || '').trim();
    if (!text) return '';
    if (/^\s*[\[{]/.test(text)) {
        try {
            const parsed = JSON.parse(text);
            const redacted = redactValue(parsed, { secrets });
            return redactText(JSON.stringify(redacted, null, 2), { secrets }).slice(0, 4000);
        } catch {
            // 非完整 JSON 时继续按纯文本脱敏输出
        }
    }
    return redactText(text, { secrets }).slice(0, 4000);
}

function buildConnectionHint({ httpStatus, upstreamStatus, causeCode, isTimeout, contentType, rawText, providerMessage, err }) {
    const raw = `${rawText || ''} ${providerMessage || ''} ${err?.message || ''}`;
    if (isTimeout) {
        return '连接或等待模型首包响应超过 30 秒。请确认本机能否直连网关地址、是否需要内网 VPN/代理，或网关当前负载是否过高。';
    }
    if (/DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|CERT_|ERR_TLS_/i.test(String(causeCode || '') + ' ' + raw)) {
        return 'HTTPS/TLS 证书校验失败（常见于企业内网自签或内部 CA 证书）。如确认内网网关可信，可取消勾选上方的「校验 HTTPS 证书」后重试，或联系管理员安装根证书 / 配置 NODE_EXTRA_CA_CERTS。';
    }
    if (/ENOTFOUND|EAI_AGAIN/i.test(String(causeCode || '') + ' ' + raw)) {
        return '域名解析失败，当前环境无法解析网关主机名。请检查 API URL 拼写，以及是否已接入对应的内网/VPN 网络。';
    }
    if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|UND_ERR_/i.test(String(causeCode || '') + ' ' + raw)) {
        return 'TCP 网络连接被拒绝、重置或超时。请检查 API URL 协议/端口、防火墙以及代理环境变量设置。';
    }
    if (/<!doctype|<html/i.test(raw) || String(contentType || '').includes('text/html') || /不是合法 JSON/.test(raw)) {
        return '接口返回了 HTML 页面或非 JSON 内容（例如网关拦截/登录页或路径错配）。请确认供应商协议、API URL 是否填至 /v1 基地址，以及是否需要附加认证请求头。';
    }
    if (upstreamStatus === 401 || upstreamStatus === 403 || httpStatus === 401 || httpStatus === 403) {
        return '鉴权失败或无权访问当前模型。请核对 API Token 是否正确且未过期、是否有目标模型权限，也可按网关要求切换「认证方式」（bearer / x-api-key / api-key / x-goog-api-key / custom）。';
    }
    if (upstreamStatus === 404 || httpStatus === 404) {
        return '网关返回 404（路径或模型不存在）。请检查 API URL（OpenAI 兼容接口通常填到 /v1 即可，无需手动拼接 /chat/completions）与模型名称拼写。';
    }
    if (upstreamStatus === 429 || httpStatus === 429) {
        return '触发网关限流或免费/配额额度已用尽（429）。请稍后重试，或切换同一渠道下的其他可用模型。';
    }
    if (/reasoning|思考过程/.test(raw)) {
        return '已连通模型网关，但本次输出的全部 tokens 都用于思考过程而未生成正文。请在下方将「最大输出 Tokens」调高（如 1024 以上）后重试。';
    }
    if ((upstreamStatus && upstreamStatus >= 500) || httpStatus >= 500) {
        return '上游模型网关返回 5xx 错误（常见原因：模型名在该渠道不可用、网关不兼容某些参数如 stream/temperature、或上游服务内部异常）。可展开详情对照响应原文，或在「高级 / 自定义协议」中调整请求参数。';
    }
    if (upstreamStatus === 400 || upstreamStatus === 422 || httpStatus === 400 || httpStatus === 422) {
        return '请求参数不被网关或模型接受。请展开详情查看上游错误字段，必要时可在「高级 / 自定义协议」里用 null 屏蔽不兼容的默认字段。';
    }
    return '请展开下方失败详情检查请求地址、HTTP 状态与上游返回原文，以便进一步定位问题。';
}

function formatFailurePayload(err, settings = {}, { durationMs = 0, requestSummary = {}, secrets = [] } = {}) {
    const scrub = value => redactText(String(value ?? ''), { secrets });
    const scrubUrl = url => aiProviderClient.sanitizeEndpointUrl(url, secrets);
    const cause = err && err.cause && typeof err.cause === 'object' ? err.cause : null;
    const causeCode = String(err?.causeCode || cause?.code || '').trim();
    const causeMessage = scrub(err?.causeMessage || cause?.message || '');
    const isTimeout = err?.name === 'AbortError' || err?.code === 'ABORT_ERR';
    const upstreamStatus = Number(err?.upstreamStatus || 0) || null;
    const localStatus = Number(err?.statusCode || err?.status || 0) || null;
    const effectiveStatus = upstreamStatus || localStatus;
    const httpStatus = isTimeout
        ? 504
        : (effectiveStatus && effectiveStatus >= 400 && effectiveStatus <= 599 ? effectiveStatus : 502);

    const providerMessage = scrub(err?.providerMessage || '');
    const errorCode = scrub(err?.providerCode || causeCode || (isTimeout ? 'REQUEST_TIMEOUT' : err?.code) || '');
    const fallbackEndpoint = settings && settings.provider ? expectedEndpointForSettings(settings) : '';
    const endpoint = scrubUrl(err?.endpoint || fallbackEndpoint);
    const rawDetail = prettifyRawDetail(
        err?.rawBody || [err?.message, causeCode ? `code: ${causeCode}` : '', causeMessage ? `cause: ${causeMessage}` : ''].filter(Boolean).join('\n'),
        secrets
    );
    const hint = buildConnectionHint({
        httpStatus,
        upstreamStatus,
        causeCode,
        isTimeout,
        contentType: err?.responseContentType,
        rawText: err?.rawBody,
        providerMessage,
        err
    });

    let friendlyError = scrub(err?.message || '模型测试失败');
    if (isTimeout) {
        friendlyError = `连接模型超时（${durationMs}ms，超过 ${Math.round(TEST_TIMEOUT_MS / 1000)} 秒未响应）`;
    } else if (/^fetch failed$/i.test(String(err?.message || '').trim()) || causeCode) {
        const suffix = [causeCode, causeMessage].filter(Boolean).join(': ');
        friendlyError = suffix ? `网络请求失败（${suffix}）` : friendlyError;
    } else if (upstreamStatus && providerMessage && !friendlyError.includes(providerMessage)) {
        friendlyError = `上游返回 HTTP ${upstreamStatus}：${providerMessage}`;
    }

    return {
        httpStatus,
        body: {
            success: false,
            error: friendlyError,
            details: {
                provider: settings?.provider || '',
                model: settings?.model || '',
                endpoint,
                httpStatus,
                upstreamStatus,
                upstreamStatusText: String(err?.upstreamStatusText || ''),
                errorCode,
                ...(err?.gatewaySource ? { gatewaySource: scrub(err.gatewaySource) } : {}),
                ...(causeMessage ? { cause: causeMessage } : {}),
                durationMs,
                ...(err?.responseContentType ? { contentType: String(err.responseContentType) } : {}),
                ...(err?.responseHeaders && Object.keys(err.responseHeaders).length ? { responseHeaders: redactValue(err.responseHeaders, { secrets }) } : {}),
                request: requestSummary,
                hint,
                ...(rawDetail ? { rawDetail } : {}),
                timestamp: new Date().toISOString()
            }
        }
    };
}

router.get('/', async (req, res) => {
    res.json(await repo.getPublicSettings());
});

router.get('/usage', async (req, res) => {
    try {
        res.json(await aiUsageRepo.getUsageStats({ dimension: req.query.dimension }));
    } catch (err) {
        res.status(500).json({ error: err.message || '读取 AI 用量失败' });
    }
});

router.delete('/usage', async (req, res) => {
    try {
        const { key, provider, model, profileId, clearAll } = req.query || {};
        const result = await aiUsageRepo.clearUsageStats({
            key,
            provider,
            model,
            profileId,
            clearAll: clearAll === 'true' || clearAll === true || key === 'all'
        });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message || '清空用量统计失败' });
    }
});

router.post('/usage/clear', async (req, res) => {
    try {
        const { key, provider, model, profileId, clearAll } = req.body || {};
        const result = await aiUsageRepo.clearUsageStats({
            key,
            provider,
            model,
            profileId,
            clearAll: clearAll === 'true' || clearAll === true || key === 'all'
        });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message || '清空用量统计失败' });
    }
});

router.put('/', async (req, res) => {
    try {
        res.json(await repo.saveSettings(req.body || {}));
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message || '保存 AI 助手设置失败' });
    }
});

// Retired setting: old clients receive an explicit response instead of silently saving aliases.
router.put('/model-aliases', (_req, res) => {
    res.status(410).json({ code: 'MODEL_ALIASES_REMOVED', error: '已取消模型名称映射，对话直接显示真实模型名称' });
});

router.post('/profiles', async (req, res) => {
    try {
        res.status(201).json(await repo.createProfile(req.body || {}));
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message || '创建 AI 配置失败' });
    }
});

router.put('/profiles/:profileId', async (req, res) => {
    try {
        res.json(await repo.saveSettings({ ...(req.body || {}), profileId: req.params.profileId }));
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message || '保存 AI 配置失败' });
    }
});

router.post('/profiles/:profileId/activate', async (req, res) => {
    try {
        res.json(await repo.activateProfile(req.params.profileId));
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message || '激活 AI 配置失败' });
    }
});

router.delete('/profiles/:profileId', async (req, res) => {
    try {
        res.json(await repo.deleteProfile(req.params.profileId));
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message || '删除 AI 配置失败' });
    }
});

async function runConnectionTest(req, res, { profileId = null } = {}) {
    const startedAt = Date.now();
    let settings = null;
    let requestSummary = {};
    try {
        const input = profileId ? { ...(req.body || {}), profileId } : (req.body || {});
        settings = await repo.buildRuntimeSettings(input);
        if (settings.authMode === 'custom' && !settings.customAuthHeader) {
            return res.status(400).json({
                success: false,
                error: '选择 custom 认证方式时，请填写自定义认证头名称（如 X-API-Key）。',
                details: {
                    provider: settings.provider,
                    model: settings.model,
                    endpoint: expectedEndpointForSettings(settings),
                    httpStatus: 400,
                    upstreamStatus: null,
                    errorCode: 'CUSTOM_AUTH_HEADER_MISSING',
                    durationMs: Date.now() - startedAt,
                    hint: '请在「自定义认证头名称」中填入网关要求的 HTTP 请求头名称（例如 X-API-Key），或改用 bearer / x-api-key 等预设方式。',
                    timestamp: new Date().toISOString()
                }
            });
        }
        if (settings.authMode !== 'none' && (!settings.hasApiKey || !settings.keyLooksValid)) {
            const missing = !settings.hasApiKey;
            return res.status(400).json({
                success: false,
                error: missing ? 'API Token 未配置或为空。' : 'API Token 格式疑似无效（长度不足 12 位或格式异常）。',
                details: {
                    provider: settings.provider,
                    model: settings.model,
                    endpoint: expectedEndpointForSettings(settings),
                    httpStatus: 400,
                    upstreamStatus: null,
                    errorCode: missing ? 'API_KEY_MISSING' : 'API_KEY_INVALID',
                    durationMs: Date.now() - startedAt,
                    hint: missing
                        ? '请填写当前供应商对应的 API Token；若网关无需认证，可将「认证方式」切换为 none。'
                        : '请核对 API Token 是否复制完整，避免包含多余空格、换行或占位文本。',
                    timestamp: new Date().toISOString()
                }
            });
        }
        const testMaxTokens = Math.min(Math.max(Math.round(Number(settings.maxOutputTokens || 512)), 512), 2048);
        const testTemperature = Number.isFinite(Number(settings.temperature)) ? Number(settings.temperature) : undefined;
        requestSummary = {
            protocol: settings.provider,
            authMode: settings.authMode,
            ...(settings.customAuthHeader ? { customAuthHeader: settings.customAuthHeader } : {}),
            verifySsl: settings.verifySsl === true,
            model: settings.model,
            stream: (settings.provider === 'openai' || settings.provider === 'openai-compatible') ? false : undefined,
            maxOutputTokens: testMaxTokens,
            temperature: testTemperature ?? null,
            hasCustomHeaders: Boolean(settings.headers && Object.keys(settings.headers).length),
            hasExtraBody: Boolean(settings.extraBody && Object.keys(settings.extraBody).length)
        };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
        let result;
        try {
            const client = aiProviderClient.createClient(settings);
            result = await client.generateText({
                systemInstruction: '你是模型连通性测试助手。请只回复 OK，不要输出多余内容。',
                prompt: '请回复：OK',
                maxOutputTokens: testMaxTokens,
                temperature: testTemperature,
                signal: controller.signal
            });
        } finally {
            clearTimeout(timer);
        }
        const replyText = String(result?.text || '').trim();
        if (!replyText) {
            const err = new Error(result?.reasoningOnly
                ? '模型已连通但本次输出仅包含思考过程（reasoning），未返回最终正文。'
                : '模型接口已响应（HTTP 200），但返回正文为空。');
            err.upstreamStatus = 200;
            err.statusCode = 502;
            err.endpoint = result?.endpoint || expectedEndpointForSettings(settings);
            err.providerCode = result?.reasoningOnly ? 'AI_REASONING_ONLY' : 'AI_EMPTY_RESPONSE';
            err.rawBody = JSON.stringify({
                finishReason: result?.finishReason || '',
                reasoningOnly: Boolean(result?.reasoningOnly),
                usage: result?.usage || {},
                raw: result?.raw || null
            }, null, 2);
            throw err;
        }
        res.json({
            success: true,
            provider: settings.provider,
            authMode: settings.authMode,
            customAuthHeader: settings.customAuthHeader || '',
            verifySsl: settings.verifySsl === true,
            anthropicAuthType: settings.anthropicAuthType,
            apiBaseUrl: settings.apiBaseUrl,
            model: settings.model,
            endpoint: result.endpoint || expectedEndpointForSettings(settings),
            durationMs: Date.now() - startedAt,
            finishReason: result.finishReason || '',
            reply: replyText.slice(0, 300),
            usage: result.usage || {}
        });
    } catch (err) {
        const repoSecrets = await repo.getRedactionSecrets().catch(() => []);
        const extraHeaderSecrets = settings?.headers && typeof settings.headers === 'object'
            ? Object.values(settings.headers).filter(v => typeof v === 'string' && v.trim().length >= 4)
            : [];
        const secrets = [...new Set([...repoSecrets, settings?.apiKey, ...extraHeaderSecrets].filter(Boolean))];
        const payload = formatFailurePayload(err, settings || {}, {
            durationMs: Date.now() - startedAt,
            requestSummary,
            secrets
        });
        console.warn(`[AI] Connection test failed (${payload.httpStatus}${payload.body.details.upstreamStatus ? `/${payload.body.details.upstreamStatus}` : ''}) model=${settings?.model || '-'} endpoint=${payload.body.details.endpoint || '-'}: ${payload.body.error}`);
        res.status(payload.httpStatus).json(payload.body);
    }
}

router.post('/test', (req, res) => runConnectionTest(req, res));

router.post('/profiles/:profileId/test', (req, res) => runConnectionTest(req, res, { profileId: req.params.profileId }));

module.exports = router;
