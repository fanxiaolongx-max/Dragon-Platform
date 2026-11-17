const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-ai-conn-test-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');

const { execFileSync } = require('node:child_process');
const https = require('node:https');
const repo = require('../backend/models/ai-settings-repository');
const { readKV, writeKV } = require('../backend/models/kv-store');
const { createClient, getBaseUrl, sanitizeEndpointUrl } = require('../backend/models/ai-provider-client');
const tenantPool = require('../backend/models/tenant-sqlite-pool');
const appDb = require('../backend/models/app-db');

test.after(async () => {
    await tenantPool.closeAll();
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

async function startTestApp(t) {
    const app = express();
    app.use(express.json());
    app.use('/api/ai-settings', require('../backend/routes/ai-settings'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
}

async function withUpstreamMock(localBase, upstreamHandler, fn) {
    const realFetch = global.fetch;
    const outbound = [];
    global.fetch = async (url, init) => {
        const textUrl = String(url);
        if (textUrl.startsWith(localBase)) {
            return realFetch(url, init);
        }
        const body = init && init.body ? JSON.parse(init.body) : null;
        outbound.push({ url: textUrl, headers: init?.headers || {}, body });
        return upstreamHandler({ url: textUrl, headers: init?.headers || {}, body, calls: outbound });
    };
    try {
        return await fn(outbound, realFetch);
    } finally {
        global.fetch = realFetch;
    }
}

test('getBaseUrl strips accidentally pasted endpoint suffixes while keeping standard /v1 roots', () => {
    assert.equal(getBaseUrl({ provider: 'openai-compatible', apiBaseUrl: 'https://aigateway.huawei.com/v1/chat/completions/' }), 'https://aigateway.huawei.com/v1');
    assert.equal(getBaseUrl({ provider: 'openai-compatible', apiBaseUrl: 'https://aigateway.huawei.com/v1' }), 'https://aigateway.huawei.com/v1');
    assert.equal(getBaseUrl({ provider: 'anthropic', apiBaseUrl: 'https://proxy.example/anthropic/v1/messages' }), 'https://proxy.example/anthropic/v1');
});

test('generateOpenAi sends explicit stream=false, handles forced SSE responses and rejects HTTP 200 error envelopes', async () => {
    const realFetch = global.fetch;
    try {
        const sent = [];
        global.fetch = async (url, init) => {
            sent.push({ url: String(url), body: JSON.parse(init.body) });
            const sseBody = [
                `data: ${JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: 'thinking...' } }] })}\n\n`,
                `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'OK dfa_Qwen-V3_6-27B' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 } })}\n\n`,
                'data: [DONE]\n\n'
            ].join('');
            return new Response(sseBody, { status: 200, headers: { 'content-type': 'text/event-stream' } });
        };

        const client = createClient({
            provider: 'openai-compatible',
            apiBaseUrl: 'https://aigateway.huawei.com/v1/chat/completions',
            model: 'dfa_Qwen-V3_6-27B',
            apiKey: 'sk-test-key-1234567890'
        });
        const res = await client.generateText({ prompt: '请回复：OK', maxOutputTokens: 512, temperature: 0.7 });
        assert.equal(sent[0].url, 'https://aigateway.huawei.com/v1/chat/completions');
        assert.equal(sent[0].body.stream, false);
        assert.equal(res.text, 'OK dfa_Qwen-V3_6-27B');
        assert.equal(res.usage.totalTokens, 18);

        global.fetch = async () => new Response(
            JSON.stringify({ error: { message: 'Model quota exhausted', code: 'INSUFFICIENT_QUOTA' } }),
            { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req-disguised-200' } }
        );
        await assert.rejects(
            () => client.generateText({ prompt: 'hi' }),
            err => err.status === 502 && err.upstreamStatus === 200 && err.providerCode === 'INSUFFICIENT_QUOTA' && /Model quota exhausted/.test(err.providerMessage)
        );
    } finally {
        global.fetch = realFetch;
    }
});

test('POST /api/ai-settings/profiles/:profileId/test returns redacted structured failure details on HTTP 500, 401 HTML and TLS errors', async t => {
    const localBase = await startTestApp(t);
    const created = await repo.createProfile({
        name: 'Gateway Diagnostic Fixture',
        provider: 'openai-compatible',
        apiBaseUrl: 'https://gateway.internal.test/v1',
        model: 'dfa_Qwen-V3_6-27B',
        apiKey: 'sk-super-secret-fixture-token-9999',
        headers: { 'X-Internal-Secret': 'hdr-secret-value-8888' },
        maxOutputTokens: 1024,
        temperature: 0.8
    });
    const profileId = created.createdProfileId;

    // 1. Upstream HTTP 500 JSON gateway failure with secret echo in response body (must be redacted)
    await withUpstreamMock(localBase, async () => {
        return new Response(
            JSON.stringify({
                time: '2026-11-17 10:20:37',
                status: 500,
                source: 'AI-Gateway',
                code: 'GW_UPSTREAM_FAIL',
                message: 'Upstream failed for key sk-super-secret-fixture-token-9999 and hdr-secret-value-8888'
            }),
            {
                status: 500,
                statusText: 'Internal Server Error',
                headers: { 'content-type': 'application/json', 'x-request-id': 'gw-trace-500' }
            }
        );
    }, async (outbound, realFetch) => {
        const res = await realFetch(`${localBase}/api/ai-settings/profiles/${encodeURIComponent(profileId)}/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: 'openai-compatible', apiBaseUrl: 'https://gateway.internal.test/v1', model: 'dfa_Qwen-V3_6-27B', temperature: 0.8 })
        });
        assert.equal(res.status, 500);
        const data = await res.json();
        assert.equal(data.success, false);
        assert.equal(outbound[0].body.stream, false);
        assert.ok(outbound[0].body.max_tokens >= 512, 'thinking models get enough output tokens');
        assert.equal(outbound[0].body.temperature, 0.8, 'honors configured temperature');

        assert.equal(data.details.upstreamStatus, 500);
        assert.equal(data.details.httpStatus, 500);
        assert.equal(data.details.endpoint, 'https://gateway.internal.test/v1/chat/completions');
        assert.equal(data.details.errorCode, 'GW_UPSTREAM_FAIL');
        assert.equal(data.details.gatewaySource, 'AI-Gateway');
        assert.equal(data.details.responseHeaders['x-request-id'], 'gw-trace-500');
        assert.ok(Number.isFinite(data.details.durationMs));
        assert.match(data.details.hint, /5xx/);
        assert.match(data.details.rawDetail, /"code": "GW_UPSTREAM_FAIL"/);
        assert.doesNotMatch(JSON.stringify(data), /sk-super-secret-fixture-token-9999/);
        assert.doesNotMatch(JSON.stringify(data), /hdr-secret-value-8888/);
    });

    // 2. HTTP 200 HTML portal page (SSO/gateway intercept) -> maps route HTTP status to 502 while preserving upstreamStatus: 200
    await withUpstreamMock(localBase, async () => {
        return new Response('<!DOCTYPE html><html><body>SSO Login Required</body></html>', {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'text/html; charset=utf-8' }
        });
    }, async (_outbound, realFetch) => {
        const res = await realFetch(`${localBase}/api/ai-settings/profiles/${encodeURIComponent(profileId)}/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        assert.equal(res.status, 502);
        const data = await res.json();
        assert.equal(data.details.httpStatus, 502);
        assert.equal(data.details.upstreamStatus, 200);
        assert.match(data.details.hint, /HTML|JSON/);
        assert.match(data.details.rawDetail, /SSO Login Required/);
    });

    // 3. TLS certificate error wrapped in Node fetch TypeError('fetch failed', { cause })
    await withUpstreamMock(localBase, async () => {
        const cause = Object.assign(new Error('self-signed certificate in certificate chain'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
        throw Object.assign(new TypeError('fetch failed'), { cause });
    }, async (_outbound, realFetch) => {
        const res = await realFetch(`${localBase}/api/ai-settings/profiles/${encodeURIComponent(profileId)}/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        assert.equal(res.status, 502);
        const data = await res.json();
        assert.match(data.error, /SELF_SIGNED_CERT_IN_CHAIN/);
        assert.equal(data.details.errorCode, 'SELF_SIGNED_CERT_IN_CHAIN');
        assert.equal(data.details.upstreamStatus, null);
        assert.match(data.details.cause, /self-signed certificate/);
        assert.match(data.details.hint, /NODE_EXTRA_CA_CERTS|证书/);
    });

    // 4. Gemini sends x-goog-api-key header by default without leaking keys in endpoint URLs; manual ?key= URLs still redact
    await withUpstreamMock(localBase, async () => {
        return new Response(JSON.stringify({ error: { code: 403, message: 'API key invalid' } }), {
            status: 403,
            headers: { 'content-type': 'application/json' }
        });
    }, async (outbound, realFetch) => {
        const res = await realFetch(`${localBase}/api/ai-settings/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider: 'gemini',
                model: 'gemini-2.5-flash',
                apiKey: 'AIzaSyFakeSecretGeminiKey1234567890'
            })
        });
        assert.equal(res.status, 403);
        assert.equal(outbound[0].headers['x-goog-api-key'], 'AIzaSyFakeSecretGeminiKey1234567890');
        const data = await res.json();
        assert.doesNotMatch(JSON.stringify(data), /AIzaSyFakeSecretGeminiKey1234567890/);
        assert.equal(data.details.endpoint, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
        assert.match(sanitizeEndpointUrl('https://example.test/v1beta?key=secret-value-12345'), /key=\[REDACTED\]/);
    });

    // 5. Success returns durationMs and cleaned reply
    await withUpstreamMock(localBase, async () => {
        return new Response(
            JSON.stringify({
                choices: [{ message: { role: 'assistant', reasoning_content: 'checked', content: 'OK dfa_self_deepseek_v4_flash' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 15, completion_tokens: 8, total_tokens: 23 }
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
        );
    }, async (_outbound, realFetch) => {
        const res = await realFetch(`${localBase}/api/ai-settings/profiles/${encodeURIComponent(profileId)}/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'dfa_self_deepseek_v4_flash' })
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.equal(data.reply, 'OK dfa_self_deepseek_v4_flash');
        assert.ok(Number.isFinite(data.durationMs));
    });
});

test('authMode supports bearer, x-api-key, api-key, x-goog-api-key, none and custom header names cleanly', async t => {
    const localBase = await startTestApp(t);
    const cases = [
        { mode: 'bearer', headerName: 'Authorization', expected: 'Bearer sk-auth-mode-token-12345' },
        { mode: 'x-api-key', headerName: 'x-api-key', expected: 'sk-auth-mode-token-12345' },
        { mode: 'api-key', headerName: 'api-key', expected: 'sk-auth-mode-token-12345' },
        { mode: 'x-goog-api-key', headerName: 'x-goog-api-key', expected: 'sk-auth-mode-token-12345' },
        { mode: 'custom', customAuthHeader: 'X-API-Key', headerName: 'X-API-Key', expected: 'sk-auth-mode-token-12345' }
    ];

    for (const item of cases) {
        await withUpstreamMock(localBase, async () => {
            return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            });
        }, async (outbound, realFetch) => {
            const res = await realFetch(`${localBase}/api/ai-settings/test`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: 'openai-compatible',
                    apiBaseUrl: 'https://auth-mode.example/v1',
                    model: 'demo-model',
                    authMode: item.mode,
                    customAuthHeader: item.customAuthHeader || '',
                    apiKey: 'sk-auth-mode-token-12345'
                })
            });
            assert.equal(res.status, 200);
            assert.equal(outbound[0].headers[item.headerName], item.expected, `${item.mode} sets ${item.headerName}`);
        });
    }

    // authMode=none works without any token and sends no auth headers
    await withUpstreamMock(localBase, async () => {
        return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        });
    }, async (outbound, realFetch) => {
        const res = await realFetch(`${localBase}/api/ai-settings/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider: 'openai-compatible',
                apiBaseUrl: 'https://noauth.example/v1',
                model: 'local-vllm',
                authMode: 'none',
                apiKey: ''
            })
        });
        assert.equal(res.status, 200);
        const hdrs = outbound[0].headers;
        assert.equal(hdrs.Authorization || hdrs.authorization, undefined);
        assert.equal(hdrs['x-api-key'], undefined);
        assert.equal(hdrs['api-key'], undefined);
    });

    // authMode=custom without header name gives explicit 400 guidance
    const resMissingHeader = await fetch(`${localBase}/api/ai-settings/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            provider: 'openai-compatible',
            apiBaseUrl: 'https://custom-missing.example/v1',
            model: 'demo-model',
            authMode: 'custom',
            customAuthHeader: '',
            apiKey: 'sk-auth-mode-token-12345'
        })
    });
    assert.equal(resMissingHeader.status, 400);
    const missingData = await resMissingHeader.json();
    assert.equal(missingData.details.errorCode, 'CUSTOM_AUTH_HEADER_MISSING');
});

test('verifySsl=true rejects self-signed HTTPS certificates while verifySsl=false connects and streams cleanly', async t => {
    const keyPath = path.join(sandbox, 'self.key');
    const certPath = path.join(sandbox, 'self.crt');
    execFileSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-keyout', keyPath, '-out', certPath,
        '-days', '1', '-nodes', '-subj', '/CN=127.0.0.1'
    ], { stdio: 'ignore' });

    const server = https.createServer({
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
    }, (req, res) => {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
            const parsed = JSON.parse(raw || '{}');
            if (parsed.stream) {
                res.writeHead(200, { 'content-type': 'text/event-stream' });
                res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'OK ' } }] })}\n\n`);
                res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'TLS' }, finish_reason: 'stop' }] })}\n\n`);
                res.end('data: [DONE]\n\n');
                return;
            }
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
                choices: [{ message: { role: 'assistant', content: `OK header=${req.headers['x-custom-gw'] || ''}` }, finish_reason: 'stop' }]
            }));
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));

    const apiBaseUrl = `https://127.0.0.1:${server.address().port}/v1`;
    const localBase = await startTestApp(t);

    // 1. Strict verifySsl=true (opt-in; default is off) rejects self-signed server
    const resStrict = await fetch(`${localBase}/api/ai-settings/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            provider: 'openai-compatible',
            apiBaseUrl,
            model: 'self-signed-model',
            verifySsl: true,
            apiKey: 'sk-self-signed-123456'
        })
    });
    assert.equal(resStrict.status, 502);
    const strictData = await resStrict.json();
    assert.match(strictData.details.hint, /校验 HTTPS 证书/);

    // 2. verifySsl=false + custom header connects cleanly over buffered HTTPS
    const resRelaxed = await fetch(`${localBase}/api/ai-settings/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            provider: 'openai-compatible',
            apiBaseUrl,
            model: 'self-signed-model',
            authMode: 'custom',
            customAuthHeader: 'X-Custom-Gw',
            verifySsl: false,
            apiKey: 'sk-self-signed-123456'
        })
    });
    assert.equal(resRelaxed.status, 200);
    const relaxedData = await resRelaxed.json();
    assert.equal(relaxedData.success, true);
    assert.equal(relaxedData.reply, 'OK header=sk-self-signed-123456');

    // 3. Streaming client also works with verifySsl=false
    const streamClient = createClient({
        provider: 'openai-compatible',
        apiBaseUrl,
        model: 'self-signed-model',
        verifySsl: false,
        apiKey: 'sk-self-signed-123456'
    });
    const deltas = [];
    const streamed = await streamClient.generateText({ prompt: 'hi', onDelta: d => deltas.push(d) });
    assert.equal(streamed.text, 'OK TLS');
    assert.deepEqual(deltas, ['OK ', 'TLS']);
});

test('legacy Gemini profiles with anthropicAuthType default or v3 bearer accident auto-heal to x-goog-api-key while v4 preserves explicit bearer', async () => {
    const legacyNormalized = await repo.buildRuntimeSettings({
        provider: 'gemini',
        anthropicAuthType: 'ANTHROPIC_AUTH_TOKEN',
        model: 'gemini-3.1-flash-lite',
        apiKey: 'AQ.FakeLegacyGeminiKey123456'
    });
    assert.equal(legacyNormalized.authMode, 'x-goog-api-key');

    const snapshot = await readKV('sys', 'ai_settings_profiles', null);
    await writeKV('sys', 'ai_settings_profiles', {
        version: 3,
        activeProfileId: 'legacy-gem',
        profiles: [{
            id: 'legacy-gem',
            name: 'Legacy Gemini',
            category: 'chat',
            provider: 'gemini',
            authMode: 'bearer',
            anthropicAuthType: 'ANTHROPIC_AUTH_TOKEN',
            apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
            model: 'gemini-3.1-flash-lite',
            models: ['gemini-3.1-flash-lite'],
            apiKey: 'AQ.FakeLegacyGeminiKey123456'
        }]
    });
    try {
        const healedRuntime = await repo.getRuntimeSettings({ profileId: 'legacy-gem' });
        assert.equal(healedRuntime.authMode, 'x-goog-api-key');
        const healedClient = createClient(healedRuntime);
        assert.equal(healedClient.buildAuthHeaders({})['x-goog-api-key'], 'AQ.FakeLegacyGeminiKey123456');
        assert.equal(healedClient.buildAuthHeaders({}).Authorization, undefined);

        // On v4+, explicit bearer for Gemini stays respected
        await repo.saveSettings({ profileId: 'legacy-gem', authMode: 'bearer' });
        const explicitRuntime = await repo.getRuntimeSettings({ profileId: 'legacy-gem' });
        assert.equal(explicitRuntime.authMode, 'bearer');
    } finally {
        if (snapshot) await writeKV('sys', 'ai_settings_profiles', snapshot);
    }
});
