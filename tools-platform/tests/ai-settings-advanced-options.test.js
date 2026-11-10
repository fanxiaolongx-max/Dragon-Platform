const test = require('node:test');
const assert = require('node:assert/strict');
const settingsRepo = require('../backend/models/ai-settings-repository');
const { createClient } = require('../backend/models/ai-provider-client');
const { readKV } = require('../backend/models/kv-store');

test('ai-settings-repository validates and normalizes extra headers and body', async () => {
    // 1. Invalid JSON string throws
    await assert.rejects(
        () => settingsRepo.buildRuntimeSettings({ headers: '{bad json' }),
        /附加请求头必须是有效的 JSON 对象/
    );
    await assert.rejects(
        () => settingsRepo.buildRuntimeSettings({ extraBody: '[1,2,3]' }),
        /附加请求参数必须是 JSON 对象/
    );

    // 2. Forbidden headers filtered out
    const runtime = await settingsRepo.buildRuntimeSettings({
        headers: {
            'Host': 'evil.com',
            'Content-Length': '123',
            'X-Project-Id': 'proj-123',
            'X-Custom-Token': 'secret-token-abc'
        },
        extraBody: {
            temperature: null,
            max_completion_tokens: 4096,
            thinking: { budget: 2048 }
        }
    });

    assert.equal(runtime.headers['Host'], undefined);
    assert.equal(runtime.headers['Content-Length'], undefined);
    assert.equal(runtime.headers['X-Project-Id'], 'proj-123');
    assert.equal(runtime.headers['X-Custom-Token'], 'secret-token-abc');

    assert.equal(runtime.extraBody.temperature, null);
    assert.equal(runtime.extraBody.max_completion_tokens, 4096);
    assert.deepEqual(runtime.extraBody.thinking, { budget: 2048 });
});

test('ai-settings-repository encrypts headers and extraBody, never returns plaintext in public settings', async () => {
    // Create a new test profile
    const created = await settingsRepo.createProfile({
        name: 'Test Advanced Profile',
        provider: 'openai-compatible',
        model: 'deepseek-chat',
        apiKey: 'sk-test-advanced-api-key-12345',
        headers: { 'X-Auth-Token': 'super-secret-token-xyz' },
        extraBody: { temperature: null, max_completion_tokens: 8000 }
    });
    const profileId = created.createdProfileId;
    assert.ok(profileId);

    // 1. Public settings check: contains flags only, NO plaintext
    const publicStore = await settingsRepo.getPublicSettings();
    const publicItem = publicStore.profiles.find(p => p.id === profileId);
    assert.ok(publicItem);
    assert.equal(publicItem.hasHeaders, true);
    assert.equal(publicItem.hasExtraBody, true);
    assert.equal(publicItem.headers, undefined);
    assert.equal(publicItem.extraBody, undefined);
    assert.equal(publicItem.extra_body, undefined);

    // 2. Underlying store check: stored as encrypted cipher, NOT plaintext JSON
    const rawStore = await readKV('sys', 'ai_settings_profiles', null);
    const rawItem = rawStore.profiles.find(p => p.id === profileId);
    assert.ok(rawItem);
    assert.ok(rawItem.headersCipher && typeof rawItem.headersCipher === 'string');
    assert.ok(rawItem.extraBodyCipher && typeof rawItem.extraBodyCipher === 'string');
    assert.equal(rawItem.headers, undefined);
    assert.equal(rawItem.extraBody, undefined);

    // 3. Runtime settings: successfully decrypted for client use
    const runtime = await settingsRepo.getRuntimeSettings({ profileId });
    assert.equal(runtime.headers['X-Auth-Token'], 'super-secret-token-xyz');
    assert.equal(runtime.extraBody.max_completion_tokens, 8000);

    // 4. Redaction check: secret headers are included in redaction secrets
    const secrets = await settingsRepo.getRedactionSecrets();
    assert.ok(secrets.includes('super-secret-token-xyz'));

    // 5. Partial update: leaving blank retains existing encrypted values
    await settingsRepo.saveSettings({
        profileId,
        name: 'Test Advanced Profile Updated'
    });
    const retained = await settingsRepo.getRuntimeSettings({ profileId });
    assert.equal(retained.headers['X-Auth-Token'], 'super-secret-token-xyz');
    assert.equal(retained.extraBody.max_completion_tokens, 8000);

    // 6. Clear: sending {} clears the encrypted values
    await settingsRepo.saveSettings({
        profileId,
        headers: {},
        extraBody: {}
    });
    const cleared = await settingsRepo.getRuntimeSettings({ profileId });
    assert.deepEqual(cleared.headers, {});
    assert.deepEqual(cleared.extraBody, {});

    const publicCleared = (await settingsRepo.getPublicSettings()).profiles.find(p => p.id === profileId);
    assert.equal(publicCleared.hasHeaders, false);
    assert.equal(publicCleared.hasExtraBody, false);

    // Cleanup
    await settingsRepo.deleteProfile(profileId);
});

test('ai-provider-client applies extra headers and merges/overrides extraBody with null omission', () => {
    const client = createClient({
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-test-openai-key-12345678',
        headers: {
            'X-Custom-Env': 'production',
            'X-Client-Version': '1.0.0'
        },
        extraBody: {
            temperature: null, // Should omit default temperature
            max_tokens: null,   // Should omit default max_tokens
            max_completion_tokens: 16000,
            stream_options: { include_usage: false }
        }
    });

    // 1. Extra headers applied
    const baseHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer sk-test-openai-key-12345678' };
    const mergedHeaders = client.applyExtraHeaders(baseHeaders);
    assert.equal(mergedHeaders['X-Custom-Env'], 'production');
    assert.equal(mergedHeaders['X-Client-Version'], '1.0.0');
    assert.equal(mergedHeaders['Authorization'], 'Bearer sk-test-openai-key-12345678');

    // 2. Extra body applied and null removes unsupported default fields
    const baseBody = {
        model: 'gpt-4o',
        temperature: 0.7,
        max_tokens: 2048,
        stream: true,
        stream_options: { include_usage: true }
    };
    const mergedBody = client.applyExtraBody(baseBody);

    assert.equal(mergedBody.model, 'gpt-4o');
    assert.equal(mergedBody.temperature, undefined, 'temperature should be omitted via null');
    assert.equal(mergedBody.max_tokens, undefined, 'max_tokens should be omitted via null');
    assert.equal(mergedBody.max_completion_tokens, 16000);
    assert.equal(mergedBody.stream_options.include_usage, false);
});
