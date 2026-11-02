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
