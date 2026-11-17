const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-ai-conn-test-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');

const repo = require('../backend/models/ai-settings-repository');
const { createClient, getBaseUrl } = require('../backend/models/ai-provider-client');
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

    // 4. Gemini endpoint redacts ?key= in failure details and thinking-model success returns durationMs
    await withUpstreamMock(localBase, async () => {
        return new Response(JSON.stringify({ error: { code: 403, message: 'API key invalid' } }), {
            status: 403,
            headers: { 'content-type': 'application/json' }
        });
    }, async (_outbound, realFetch) => {
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
        const data = await res.json();
        assert.doesNotMatch(JSON.stringify(data), /AIzaSyFakeSecretGeminiKey1234567890/);
        assert.match(data.details.endpoint, /key=\[REDACTED\]/);
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
