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
    assert.ok(names.has('open_autoglm'));

    const prompt = autoglmAgent.buildPrompt();
    assert.ok(typeof prompt === 'string' && prompt.includes('open_autoglm_get_screenshot'));
    assert.ok(prompt.includes('打卡设置 截图看看') || prompt.includes('复合指令'));
});

test('open-autoglm autoSelect recognizes direct queries and session followups', () => {
    const skills = require('../backend/models/agent-skills');
    
    // 1. Direct keywords
    assert.deepEqual(skills.autoSelect('打卡设置 截图看看'), ['open-autoglm']);
    assert.deepEqual(skills.autoSelect('查看一下当前屏幕'), ['open-autoglm']);
    assert.deepEqual(skills.autoSelect('在手机上打开微信'), ['open-autoglm']);
    assert.deepEqual(skills.autoSelect('截个屏看看手机'), ['open-autoglm']);

    // 2. Follow-up in session that used open-autoglm
    const sessionHistory = [
        { role: 'user', content: '@open-autoglm 查看一下当前屏幕' },
        { role: 'assistant', content: '![手机实时屏幕](phone.png)' }
    ];
    assert.deepEqual(skills.autoSelect('打卡设置', { contextMessages: sessionHistory }), ['open-autoglm']);
    assert.deepEqual(skills.autoSelect('点击确定', { contextMessages: sessionHistory }), ['open-autoglm']);
    assert.deepEqual(skills.autoSelect('向下滑动一点', { contextMessages: sessionHistory }), ['open-autoglm']);
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

test('open-autoglm execute aliases and progress callback support', async () => {
    // 1. Alias open_autoglm should exist in definitions
    const defs = autoglmAgent.definitions();
    const aliasDef = defs.find(d => d.name === 'open_autoglm');
    assert.ok(aliasDef, 'open_autoglm alias should be defined');

    // 2. Unknown tool should return isError: true without throw
    const outcome = await autoglmAgent.execute('open_autoglm_nonexistent_xyz');
    assert.equal(outcome.isError, true);
    assert.ok(outcome.content.includes('未知的 Open-AutoGLM 工具'));
});
