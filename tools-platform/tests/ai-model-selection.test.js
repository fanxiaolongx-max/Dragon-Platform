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

test('aliases expose only custom names and fall back to the active profile', () => {
    const aliases = repo.normalizeModelAliases([
        { id: 'aragon', name: 'Aragon', profileId: '' },
        { id: 'deep', name: 'Aragon Pro', description: 'Deeper reasoning', profileId: 'pro' },
        { id: 'gone', name: 'Orphan', profileId: 'deleted-profile' },
        { name: 'aragon' },
        { name: '   ' }
    ]);
    assert.deepEqual(aliases.map(item => item.name), ['Aragon', 'Aragon Pro', 'Orphan'], 'blank and duplicate names are dropped');

    const choices = repo.buildModelChoices(store, aliases);
    assert.equal(choices.mode, 'alias');
    assert.equal(choices.defaultId, 'aragon');
    assert.equal(choices.models.find(item => item.id === 'aragon').profileId, 'main');
    assert.equal(choices.models.find(item => item.id === 'deep').profileId, 'pro');
    assert.equal(choices.models.find(item => item.id === 'gone').profileId, 'main', 'deleted profiles follow the active one');

    assert.equal(repo.pickModelChoice(choices, 'deep').profileId, 'pro');
    assert.equal(repo.pickModelChoice(choices, 'profile:pro').id, 'aragon', 'raw profile ids are not selectable in alias mode');
    assert.equal(repo.pickModelChoice(choices, '<script>').id, 'aragon');
    assert.equal(repo.pickModelChoice(choices, undefined).id, 'aragon');

    const publicView = repo.publicModelChoices(choices);
    assert.deepEqual(Object.keys(publicView.models[0]).sort(), ['description', 'id', 'name'], 'profile ids stay server-side');
});

test('empty mapping lists real model names of ready profiles', () => {
    const choices = repo.buildModelChoices(store, []);
    assert.equal(choices.mode, 'direct');
    assert.deepEqual(choices.models.map(item => item.name), ['gemini-2.5-flash', 'deep-model']);
    assert.equal(choices.defaultId, 'profile:main');
    assert.equal(repo.pickModelChoice(choices, 'profile:pro').profileId, 'pro');
    assert.equal(repo.pickModelChoice(choices, 'profile:empty').profileId, 'main', 'profiles without a token fall back to default');
});

test('stored aliases default to Aragon, persist edits and resolve chat runtime settings', async () => {
    assert.deepEqual((await repo.getModelAliases()).map(item => item.name), ['Aragon']);
    assert.equal((await repo.getModelChoices()).models[0].name, 'Aragon');

    const created = await repo.createProfile({ name: 'Pro', provider: 'openai', model: 'gpt-4o', apiKey: 'pro-token-1234567890' });
    const proId = created.createdProfileId;
    const saved = await repo.saveModelAliases([
        { id: 'aragon', name: 'Aragon', profileId: '' },
        { id: 'aragon-pro', name: 'Aragon Pro', profileId: proId },
        { id: 'bad', name: 'Bad', profileId: 'missing' }
    ]);
    assert.deepEqual(saved.modelAliases.map(item => [item.name, item.profileId]), [['Aragon', ''], ['Aragon Pro', proId], ['Bad', '']]);

    const choice = await repo.resolveModelChoice('aragon-pro');
    const runtime = await repo.getRuntimeSettings({ profileId: choice.profileId });
    assert.equal(runtime.model, 'gpt-4o');
    assert.notEqual((await repo.getRuntimeSettings()).model, 'gpt-4o', 'without a selection the active profile is used');
    assert.equal((await repo.resolveModelChoice('unknown')).id, 'aragon');

    const cleared = await repo.saveModelAliases([]);
    assert.deepEqual(cleared.modelAliases, [], 'an empty mapping is kept instead of reseeding Aragon');
    const direct = await repo.getModelChoices();
    assert.equal(direct.mode, 'direct');
    assert.ok(direct.models.some(item => item.name === 'gpt-4o'));

    await assert.rejects(repo.saveModelAliases('nope'), /格式无效/);
});

test('chat route, model list API and admin mapping API are wired', () => {
    const ai = read('backend/routes/ai.js');
    assert.match(ai, /router\.get\('\/models', checkAuth/);
    assert.match(ai, /resolveModelChoice\(req\.body\.modelId\)/);
    assert.match(ai, /getRuntimeSettings\(\{ profileId: modelChoice\?\.profileId \}\)/);
    assert.match(ai, /model: \{ id: modelChoice\.id, name: modelChoice\.name \}/);
    assert.match(read('backend/routes/ai-settings.js'), /router\.put\('\/model-aliases'/);
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

test('global settings AI tab edits the model name mapping in both languages', () => {
    const navbar = read('frontend/js/shared/navbar.js');
    assert.match(navbar, /id="navAiAliasPanel"/);
    assert.match(navbar, /\/api\/ai-settings\/model-aliases/);
    ['addAiModelAlias', 'removeAiModelAlias', 'clearAiModelAliases', 'resetAiModelAliases', 'updateAiModelAlias']
        .forEach(name => assert.match(navbar, new RegExp(`window\\.${name} = function`)));
    const keys = navbar.match(/'nav\.ai\.alias[A-Za-z]+'/g) || [];
    const counts = keys.reduce((map, key) => map.set(key, (map.get(key) || 0) + 1), new Map());
    for (const [key, count] of counts) assert.ok(count >= 2, `${key} has zh and en text`);
});
