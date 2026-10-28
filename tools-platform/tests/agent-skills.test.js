const test = require('node:test');
const assert = require('node:assert/strict');
const skills = require('../backend/models/agent-skills');

test('builtin catalog loads actual SKILL.md files on demand and exposes metadata only', () => {
    const dirs = require('node:fs').readdirSync(require('node:path').join(__dirname, '../backend/agent-skills'), { withFileTypes: true }).filter(entry => entry.isDirectory()).length;
    assert.equal(skills.list().length, dirs); // 「转为内置」会新增目录，数量以实际目录为准
    assert.ok(skills.list().length >= 6);
    for (const item of skills.list()) {
        assert.equal('prompt' in item, false);
        const loaded = skills.load(`@${item.id} do this`, { hasWorkspace: true });
        assert.equal(loaded.selected[0].id, item.id);
        assert.match(loaded.prompt, /目标：/);
        assert.ok(loaded.prompt.length < 6000);
    }
    const catalog = skills.list(); catalog[0].id = 'changed';
    assert.equal(skills.list()[0].id, 'project-map');
});

test('mentions are explicit, deduplicated and never interpreted as filesystem paths', () => {
    assert.deepEqual(skills.select('mail@example.com /tmp/@debug x@debug @debugger @../../secret @unknown'), []);
    assert.deepEqual(skills.select('@DEBUG，看看这里 @debug @write-doc').map(item => item.id), ['debug', 'write-doc']);
    assert.equal(skills.load('do something').prompt, '');
    assert.equal(skills.load('前文提到 skill，但本次没有选择').selected.length, 0);
});

test('project skills need a real workspace while writing a draft does not grant tools or permissions', () => {
    assert.throws(() => skills.load('@debug troubleshoot'), { code: 'SKILL_WORKSPACE_REQUIRED', statusCode: 400 });
    assert.throws(() => skills.load('@code-review review', { language: 'en' }), /Choose a workspace/);
    const draft = skills.load('@write-doc draft an intro');
    assert.equal(draft.selected[0].workspace, false);
    assert.match(draft.prompt, /普通用户保持只读/);
    assert.match(draft.prompt, /不改变账号权限和审批模式/);
});

test('Chinese text may touch a mention, while emails, paths and file names never load a Skill', () => {
    for (const text of ['@debug帮我看看', '请用@debug看看', '用@debug。', '@DEBUG，看看']) assert.deepEqual(skills.select(text).map(item => item.id), ['debug'], text);
    for (const text of ['mail a@debug.com', 'x@debug', '/tmp/@debug', 'C:\\@debug', '@debug/x', '@debug.js', '@debugger']) assert.deepEqual(skills.select(text), [], text);
    assert.deepEqual(skills.mentions('@code-reveiw 看下 @debug @张三').unknown, ['code-reveiw']);
    assert.deepEqual(skills.load('@code-reveiw 看下', { hasWorkspace: true }).unknown, ['code-reveiw']);
});

test('kept Skills from the composer chips load by whitelist only and still need a workspace', () => {
    const loaded = skills.load('继续修复', { hasWorkspace: true, extraIds: ['debug', '../../etc/passwd', 'not-a-skill', 'DEBUG'] });
    assert.deepEqual(loaded.selected.map(item => item.id), ['debug']);
    assert.match(loaded.prompt, /### @debug/);
    assert.throws(() => skills.load('继续', { extraIds: ['code-review'] }), { code: 'SKILL_WORKSPACE_REQUIRED', skills: ['code-review'] });
});

test('catalog metadata comes from SKILL.md front-matter, which is never sent to the model', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const dir = path.join(__dirname, '../backend/agent-skills');
    const ids = fs.readdirSync(dir).filter(name => fs.existsSync(path.join(dir, name, 'SKILL.md')));
    assert.deepEqual(skills.list().map(item => item.id).sort(), ids.sort(), 'every Skill directory is listed without a second registry');
    const debug = skills.list().find(item => item.id === 'debug');
    assert.deepEqual([debug.name, debug.nameEn, debug.workspace], ['排查故障', 'Debug', true]);
    const prompt = skills.load('@debug x', { hasWorkspace: true }).prompt;
    assert.doesNotMatch(prompt, /name_en:|description_en:|^---$/m);
});

test('skill authoring keeps the platform save contract even with customized instructions and confirmation-only follow-ups', () => {
    for (const id of ['create-skill', 'improve-skill']) {
        const prompt = skills.load('确认', { extraIds: [id] }).prompt;
        assert.match(prompt, /平台技能保存规则/);
        assert.match(prompt, /用户回复“确认”也不会触发保存接口/);
        assert.match(prompt, /```skill/);
        assert.match(prompt, /草稿尚未保存/);
        const customized = skills.buildPrompt([`### @${id}\n目标：旧的自定义流程。`]);
        assert.match(customized, /只有界面保存接口返回成功/);
    }
    assert.doesNotMatch(skills.load('@write-doc draft a document').prompt, /平台技能保存规则/);
});
