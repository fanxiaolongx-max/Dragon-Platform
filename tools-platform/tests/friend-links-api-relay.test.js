const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = require('../backend/models/friend-links-repository');
const claudeCodeConfig = require('../backend/models/claude-code-config-service');

test('API relay defaults use verified model names', () => {
    assert.equal(repo.DEFAULT_API_RELAY.openAiModel, 'gemini-3-flash');
    assert.equal(repo.DEFAULT_API_RELAY.defaultModel, 'claude-3-5-sonnet-20241022');
    assert.equal(repo.DEFAULT_API_RELAY.fastModel, 'gemini-2.5-flash');
});

test('legacy relay model aliases migrate without replacing custom models', () => {
    assert.deepEqual(repo.migrateLegacyApiRelayModels({
        defaultModel: 'gemini-3-1-flash',
        fastModel: 'gemini-2-5-flash'
    }), {
        openAiModel: 'gemini-3-flash',
        defaultModel: 'claude-3-5-sonnet-20241022',
        fastModel: 'gemini-2.5-flash'
    });

    assert.deepEqual(repo.migrateLegacyApiRelayModels({
        defaultModel: 'claude-sonnet-4-5',
        fastModel: 'custom-fast-model'
    }), {
        openAiModel: 'claude-sonnet-4-5',
        defaultModel: 'claude-sonnet-4-5',
        fastModel: 'custom-fast-model'
    });
});

test('Claude Code receives the verified Anthropic main and fast models', () => {
    const settings = claudeCodeConfig.buildClaudeCodeSettings({}, repo.DEFAULT_API_RELAY);
    assert.equal(settings.env.ANTHROPIC_MODEL, 'claude-3-5-sonnet-20241022');
    assert.equal(settings.env.ANTHROPIC_SMALL_FAST_MODEL, 'gemini-2.5-flash');
});

test('Gemini quick integration uses the working OpenAI-compatible REST route', () => {
    const html = ['index.html', 'js/home/home-page.js'].map(file => fs.readFileSync(path.join(__dirname, '../frontend', file), 'utf8')).join('\n');
    assert.match(html, /Gemini · OpenAI REST/);
    assert.match(html, /"\$\{openAiBase\}\/chat\/completions"/);
    assert.doesNotMatch(html, /\/v1beta\/models\/\$\{config\.defaultModel\}:generateContent/);
});
