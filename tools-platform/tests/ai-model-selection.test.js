const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-ai-model-selection-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');

const repo = require('../backend/models/ai-settings-repository');
const tenantPool = require('../backend/models/tenant-sqlite-pool');

const root = path.join(__dirname, '..');
const read = relPath => fs.readFileSync(path.join(root, relPath), 'utf8');

test.after(async () => {
    await tenantPool.closeAll();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

const store = {
    activeProfileId: 'main',
    profiles: [
        { id: 'main', name: 'Main', provider: 'gemini', model: 'gemini-2.5-flash', apiKey: 'main-token-1234567890' },
        { id: 'pro', name: 'Pro', provider: 'openai-compatible', model: 'deep-model', apiKey: 'pro-token-1234567890' },
        { id: 'empty', name: 'No key', provider: 'minimax', model: 'MiniMax-M3', apiKey: '' }
    ]
};

test('chat choices always expose real model names, ignoring legacy aliases', () => {
    const choices = repo.buildModelChoices(store, [{ id: 'aragon', name: 'Aragon', profileId: '' }]);
    assert.equal(choices.mode, 'direct');
    assert.deepEqual(choices.models.map(item => item.name), ['gemini-2.5-flash', 'deep-model']);
    assert.equal(choices.defaultId, 'profile:main');
    assert.equal(repo.pickModelChoice(choices, 'profile:pro').profileId, 'pro');
    assert.equal(repo.pickModelChoice(choices, 'profile:empty').profileId, 'main');
    const publicView = repo.publicModelChoices(choices);
    assert.equal(publicView.models[1].provider, 'openai-compatible');
    assert.equal(publicView.models[1].description, 'Pro');
    assert.ok(!JSON.stringify(publicView).includes('token-'));
    assert.ok(!Object.hasOwn(publicView.models[0], 'apiKey'));
    assert.ok(!Object.hasOwn(publicView.models[0], 'apiBaseUrl'));
});

test('channel with multiple models expands choices and resolves individual models cleanly', () => {
    const multiStore = {
        activeProfileId: 'chan1',
        profiles: [
            {
                id: 'chan1',
                name: 'DragonAPI',
                provider: 'openai',
                model: 'gpt-5.6-luna',
                models: ['gpt-5.6-luna', 'grok-4.7'],
                apiKey: 'api-token-1234567890'
            }
        ]
    };
    const choices = repo.buildModelChoices(multiStore);
    assert.equal(choices.models.length, 2);
    assert.equal(choices.models[0].name, 'gpt-5.6-luna');
    assert.equal(choices.models[0].id, 'profile:chan1');
    assert.equal(choices.models[1].name, 'grok-4.7');
    assert.equal(choices.models[1].id, 'profile:chan1:grok-4.7');

    const primaryPick = repo.pickModelChoice(choices, 'profile:chan1');
    assert.equal(primaryPick.modelName, 'gpt-5.6-luna');
    assert.equal(primaryPick.profileId, 'chan1');

    const secondPick = repo.pickModelChoice(choices, 'profile:chan1:grok-4.7');
    assert.equal(secondPick.modelName, 'grok-4.7');
    assert.equal(secondPick.profileId, 'chan1');
});

test('unconfigured profiles still identify the real active model and never show image models', () => {
    const choices = repo.buildModelChoices({ ...store, profiles: store.profiles.map(item => ({ ...item, apiKey: '' })) });
    assert.equal(choices.models[0].name, 'gemini-2.5-flash');
    const withImage = repo.buildModelChoices({ ...store, profiles: [...store.profiles, { id: 'image', category: 'image', model: 'gpt-image-1', apiKey: 'image-token-12345' }] });
    assert.equal(withImage.models.some(item => item.profileId === 'image'), false);
});

test('legacy selections keep the underlying profile, while all public names are real', async () => {
    const { writeKV } = require('../backend/models/kv-store');
    assert.deepEqual(await repo.getModelAliases(), []);
    assert.equal((await repo.getModelChoices()).models[0].name, 'gemini-2.5-flash');
    const created = await repo.createProfile({ name: 'Pro', provider: 'openai', model: 'gpt-4o', apiKey: 'pro-token-1234567890' });
    const proId = created.createdProfileId;
    await writeKV('sys', 'ai_model_aliases', { aliases: [{ id: 'aragon-pro', name: 'Aragon Pro', profileId: proId }] });
    const choice = await repo.resolveModelChoice('aragon-pro');
    assert.equal(choice.id, `profile:${proId}`);
    assert.equal(choice.name, 'gpt-4o');
    assert.equal((await repo.getRuntimeSettings({ profileId: choice.profileId })).model, 'gpt-4o');
    assert.deepEqual((await repo.getPublicSettings()).modelAliases, []);
    assert.ok((await repo.getModelChoices()).models.every(item => !item.name.includes('Aragon')));
    assert.equal((await repo.resolveModelChoice('unknown')).id, (await repo.getModelChoices()).defaultId);
});

test('real model choices and legacy selection resolution remain tenant isolated', async () => {
    const { runWithTenant } = require('../backend/models/tenant-context');
    await runWithTenant('other-model-tenant', async () => {
        const choices = await repo.getModelChoices();
        assert.ok(choices.models.every(item => item.name !== 'gpt-4o'));
        assert.equal((await repo.resolveModelChoice('aragon-pro')).id, choices.defaultId);
    });
});

test('retired model mapping endpoint returns an explicit error without writing', async t => {
    const express = require('express');
    const app = express(); app.use(express.json());
    app.use('/api/ai-settings', require('../backend/routes/ai-settings'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ai-settings/model-aliases`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aliases: [] }) });
    assert.equal(response.status, 410);
    assert.equal((await response.json()).code, 'MODEL_ALIASES_REMOVED');
});

test('chat route and model list use real model choices', () => {
    const ai = read('backend/routes/ai.js');
    assert.match(ai, /router\.get\('\/models', checkAuth/);
    assert.match(ai, /resolveModelChoice\(req\.body\.modelId\)/);
    assert.match(ai, /getRuntimeSettings\(\{ profileId: modelChoice\?\.profileId \}\)/);
});

test('Dragon Claw composer offers a remembered model picker that applies from the next message', () => {
    const html = read('frontend/index.html');
    const agent = read('frontend/js/home/dragon-claw.js');
    ['dcModel', 'dcModelBtn', 'dcModelName', 'dcModelMenu', 'dcToast'].forEach(id => assert.match(html, new RegExp(`id="${id}"`), `${id} exists`));
    assert.match(agent, /fetch\('\/api\/ai\/models'/);
    assert.match(agent, /MODEL_STORAGE_KEY/);
    assert.match(agent, /modelId: model\.id/);
    assert.ok(agent.indexOf('const model = currentModel();') < agent.indexOf('api.requestStreamingChat('), 'model is locked when the message is sent');
    assert.match(agent, /modelNextMessage: '已切换到 \{name\}，从下一条消息开始生效'/);
    assert.match(agent, /modelNextMessage: 'Switched to \{name\}\. Applies from your next message\.'/);
});

test('global settings removes editable model mappings in both languages', () => {
    const navbar = read('frontend/js/shared/navbar.js') + '\n' + read('frontend/js/shared/navbar-settings.js');
    assert.doesNotMatch(navbar, /navAiAliasPanel|addAiModelAlias|resetAiModelAliases/);
    assert.equal((navbar.match(/'nav\.ai\.modelIdentityHelp':/g) || []).length, 2);
});
