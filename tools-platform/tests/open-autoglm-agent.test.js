const test = require('node:test');
const assert = require('node:assert/strict');
const autoglmAgent = require('../backend/models/open-autoglm-agent');
const toolRegistry = require('../backend/models/agent-tool-registry');

test('open-autoglm-agent definitions and prompt satisfy tool registry contract', () => {
    const defs = autoglmAgent.definitions();
    assert.ok(Array.isArray(defs) && defs.length >= 4);

    const names = new Set(defs.map(d => d.name));
    assert.ok(names.has('open_autoglm_get_screenshot'));
    assert.ok(names.has('open_autoglm_list_devices'));
    assert.ok(names.has('open_autoglm_run_task'));
    assert.ok(names.has('open_autoglm_action'));

    const prompt = autoglmAgent.buildPrompt();
    assert.ok(typeof prompt === 'string' && prompt.includes('open_autoglm_get_screenshot'));
});

test('open-autoglm toolset attaches without requiring workspace', async () => {
    const session = {
        owner: 'test_user',
        loadedTools: new Set(),
        loadedSkills: new Set(),
        readOnly: false
    };

    const registry = await toolRegistry.create({
        session,
        skillIds: ['open-autoglm'],
        messages: [],
        core: false
    });

    const toolset = registry.toolset('open_autoglm_get_screenshot');
    assert.ok(toolset, 'open_autoglm_get_screenshot should be resolvable via registry toolset');
    assert.equal(typeof toolset.execute, 'function');
});
