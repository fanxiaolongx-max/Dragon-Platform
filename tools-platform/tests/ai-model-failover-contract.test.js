const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const settingsSource = fs.readFileSync(path.join(root, 'backend/models/ai-settings-repository.js'), 'utf8');
const usageSource = fs.readFileSync(path.join(root, 'backend/models/ai-usage-repository.js'), 'utf8');
const navbarSource = ['navbar.js', 'navbar-settings.js'].map(file => fs.readFileSync(path.join(root, 'frontend/js/shared', file), 'utf8')).join('\n');
const { createClient, isAutoSwitchableError } = require('../backend/models/ai-provider-client');

test('usage ledger records provider, model, and profile dimensions', () => {
    assert.match(usageSource, /CREATE TABLE IF NOT EXISTS ai_usage_daily_models/);
    assert.match(usageSource, /PRIMARY KEY \(usage_date, provider, model, profile_id\)/);
    assert.match(usageSource, /models,/);
    assert.match(usageSource, /unclassified:/);
    assert.match(navbarSource, /setAiUsageModel/);
});

test('auto-switch is persisted and only builds valid fallback profiles', () => {
    assert.match(settingsSource, /autoSwitchEnabled: raw\.autoSwitchEnabled === true/);
    assert.match(settingsSource, /fallbackProfiles/);
    assert.match(settingsSource, /filter\(item => item\.hasApiKey && item\.keyLooksValid\)/);
    assert.match(navbarSource, /id="navAiAutoSwitch"/);
});

test('client enables fallback for service errors but not user aborts', () => {
    assert.equal(isAutoSwitchableError({ status: 429 }, false), true);
    assert.equal(isAutoSwitchableError({ status: 503 }, false), true);
    assert.equal(isAutoSwitchableError({ name: 'AbortError' }, false), false);
    assert.equal(isAutoSwitchableError({ status: 503 }, true), false);

    const client = createClient({
        provider: 'openai', model: 'primary', apiKey: 'primary-token-123', hasApiKey: true, keyLooksValid: true,
        autoSwitchEnabled: true,
        fallbackProfiles: [{ provider: 'gemini', model: 'backup', apiKey: 'backup-token-123', hasApiKey: true, keyLooksValid: true }]
    });
    assert.equal(client.constructor.name, 'AutoSwitchAiClient');
});

test('model circuit breaker skips a failing profile for 60s and records a switch notice', async () => {
    const providerModule = require('../backend/models/ai-provider-client');
    const alertRepo = require('../backend/models/alert-center-repository');
    const originalAdd = alertRepo.addEvent;
    const notices = [];
    alertRepo.addEvent = async event => { notices.push(event); return event; };
    const calls = [];
    const proto = Object.getPrototypeOf(providerModule.createClient({ provider: 'openai', model: 'x', apiKey: 'k', hasApiKey: true, keyLooksValid: true }));
    const originalGenerate = proto.generateText;
    proto.generateText = async function () {
        calls.push(this.model);
        if (this.model === 'primary') throw Object.assign(new Error('upstream 503 token=primary-token-123'), { status: 503 });
        return { text: `ok from ${this.model}` };
    };
    try {
        providerModule.resetModelBreakers();
        const settings = {
            provider: 'openai', model: 'primary', apiKey: 'primary-token-123', hasApiKey: true, keyLooksValid: true, profileId: 'p1',
            autoSwitchEnabled: true,
            fallbackProfiles: [{ provider: 'openai', model: 'backup', apiKey: 'backup-token-123', hasApiKey: true, keyLooksValid: true, profileId: 'p2' }]
        };
        for (let i = 0; i < 3; i += 1) {
            const result = await providerModule.createClient(settings).generateText({ prompt: 'hi' });
            assert.equal(result.text, 'ok from backup');
            assert.equal(result.autoSwitch.from, 'openai/primary');
        }
        assert.deepEqual(calls, ['primary', 'backup', 'primary', 'backup', 'primary', 'backup']);
        assert.equal(notices.length, 1, 'one notice per primary→backup pair within 10 minutes');
        assert.match(notices[0].title, /openai\/primary → openai\/backup/);
        assert.doesNotMatch(notices[0].message, /primary-token-123/);
        // after 3 failures the primary is skipped: the backup answers first and no switch happens
        calls.length = 0;
        const direct = await providerModule.createClient(settings).generateText({ prompt: 'hi' });
        assert.deepEqual(calls, ['backup']);
        assert.equal(direct.autoSwitch, undefined);
    } finally {
        proto.generateText = originalGenerate;
        alertRepo.addEvent = originalAdd;
        providerModule.resetModelBreakers();
    }
});
