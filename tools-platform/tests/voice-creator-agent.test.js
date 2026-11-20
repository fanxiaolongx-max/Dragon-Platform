const test = require('node:test');
const assert = require('node:assert/strict');
const voiceAgent = require('../backend/models/voice-creator-agent');
const toolAccess = require('../backend/models/agent-tool-access');
const skillsStore = require('../backend/models/agent-skills-store');

test('voice-creator definitions and prompt satisfy contract', () => {
    const defs = voiceAgent.definitions();
    assert.ok(Array.isArray(defs));
    assert.equal(defs.length, 2);
    assert.ok(defs.some(d => d.name === 'voice_creator_list_voices'));
    assert.ok(defs.some(d => d.name === 'voice_creator_generate'));

    const prompt = voiceAgent.buildPrompt();
    assert.ok(typeof prompt === 'string' && prompt.includes('Fish Audio'));
    assert.ok(prompt.includes('语彤') && prompt.includes('交互选择声音'));
});

test('voice-creator lists all 12 official safe voices', async () => {
    assert.equal(voiceAgent.OFFICIAL_VOICES.length, 12);

    const outcome = await voiceAgent.execute('voice_creator_list_voices');
    assert.equal(outcome.isError, undefined);
    const parsed = JSON.parse(outcome.content);
    assert.equal(parsed.length, 12);

    // Verify key official voices exist
    const names = parsed.map(v => v.name);
    assert.ok(names.includes('语彤'));
    assert.ok(names.includes('梓轩'));
    assert.ok(names.includes('晓彤'));
    assert.ok(names.includes('建国'));
    assert.ok(names.includes('雨薇'));
    assert.ok(names.includes('柏翰'));

    // Filter by gender
    const femaleOutcome = await voiceAgent.execute('voice_creator_list_voices', { gender: '女性' });
    const femaleList = JSON.parse(femaleOutcome.content);
    assert.ok(femaleList.length >= 6);
    assert.ok(femaleList.every(v => v.gender === '女性'));
});

test('voice-creator securely resolves API key from vault', async () => {
    const { vault } = require('../backend/models/password-vault');
    const v = vault();
    await v.saveSecret('admin', {
        name: 'FISH_AUDIO_API_KEY',
        value: 'sk-fish-Chi6HpC-lCCjSfyJfzjrkyfSrP6vr_uixLpISq_m_-k',
        category: 'api_key',
        label: 'Fish Audio Key'
    });

    const key = await voiceAgent.getApiKey('admin');
    assert.ok(key, 'must resolve API key from vault');
    assert.equal(key, 'sk-fish-Chi6HpC-lCCjSfyJfzjrkyfSrP6vr_uixLpISq_m_-k');
});

test('voice-creator blocks non-superadmin user from execution when unshared (非公开)', async () => {
    const blockedOutcome = await voiceAgent.execute('voice_creator_generate', { text: '测试' }, {
        user: { username: 'normal_user', role: 'developer', isSuper: false }
    });
    assert.equal(blockedOutcome.isError, true);
    assert.ok(blockedOutcome.content.includes('未全员开放') || blockedOutcome.summary.includes('未开放'));
});

test('skillsStore isolates voice-creator from normal users (非公开未全员开放)', async () => {
    const superAdminSkills = await skillsStore.listForUser({ username: 'admin', role: 'admin', isSuper: true });
    const normalSkills = await skillsStore.listForUser({ username: 'normal_user', role: 'developer', isSuper: false });

    const superAdminVoice = superAdminSkills.find(s => s.id === 'voice-creator');
    const normalVoice = normalSkills.find(s => s.id === 'voice-creator');

    assert.ok(superAdminVoice, 'superadmin should see voice-creator skill');
    assert.equal(superAdminVoice.sharedAccess, false, 'must be marked as unshared (sharedAccess: false)');
    assert.equal(normalVoice, undefined, 'normal user must NOT see unshared voice-creator skill');
});

test('agent-tool-access denies voice tools for normal user by default', async () => {
    const canActorUse = await toolAccess.forActor({ username: 'normal_user', role: 'developer', isSuper: false }, 'team-xyz::normal_user');
    assert.equal(canActorUse('voice_creator_generate'), false, 'voice_creator tools must be denied for non-superadmin');

    const canSuperAdminUse = await toolAccess.forActor({ username: 'admin', role: 'admin', isSuper: true });
    assert.equal(canSuperAdminUse('voice_creator_generate'), true, 'voice_creator tools must be allowed for superadmin');
});

test('voice-creator toolset attached via agent-tool-registry provides preview and execute', async () => {
    const registry = require('../backend/models/agent-tool-registry');
    const reg = await registry.create({
        root: process.cwd(),
        allowed: () => true,
        skillIds: ['voice-creator'],
        actor: { username: 'admin', role: 'admin', isSuper: true },
        session: {
            loadedTools: new Set(),
            loadedSkills: new Set(),
            owner: 'admin',
            username: 'admin'
        }
    });
    const set = reg.toolset('voice_creator_generate');
    assert.ok(set, 'voice_creator toolset should attach for voice-creator skill');
    assert.equal(typeof set.preview, 'function', 'toolset must implement preview() for run-manager');
    const previewed = await set.preview('voice_creator_generate', { text: '撒个娇', voice: '语彤' });
    assert.equal(previewed.action, 'voice_creator_generate');
    assert.ok(previewed.command.includes('语彤'));
});
