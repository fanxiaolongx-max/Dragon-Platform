const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const builtinSkills = require('../backend/models/agent-skills.js');
const ppoAgent = require('../backend/models/ppo-traffic-agent.js');
const agentToolRegistry = require('../backend/models/agent-tool-registry.js');
const agentToolAccess = require('../backend/models/agent-tool-access.js');

test('ppo-traffic is registered as a builtin skill with workspace:false', () => {
    builtinSkills.reload();
    const skills = builtinSkills.list();
    const ppoSkill = skills.find(s => s.id === 'ppo-traffic');
    assert.ok(ppoSkill, 'ppo-traffic skill must be present in catalog');
    assert.equal(ppoSkill.name, '埃及车辆违章查询');
    assert.equal(ppoSkill.nameEn, 'Egypt Traffic Violations');
    assert.equal(ppoSkill.icon, '🚗');
    assert.equal(ppoSkill.workspace, false, 'Traffic queries must not require workspace');
    assert.deepEqual(ppoSkill.tools, ['ppo-traffic']);
});

test('mentions recognize @ppo-traffic and localized @埃及车辆违章查询', () => {
    builtinSkills.reload();
    const m1 = builtinSkills.mentions('帮我查一下 @ppo-traffic 车牌 أ ف س 3413');
    assert.deepEqual(m1.known, ['ppo-traffic']);

    const m2 = builtinSkills.mentions('请使用 @埃及车辆违章查询 查违章');
    assert.deepEqual(m2.known, ['ppo-traffic']);
});

test('autoSelect recognizes traffic violation queries and context followups', () => {
    builtinSkills.reload();
    const s1 = builtinSkills.autoSelect('查一下车牌 أ ف س 3413、护照 E12345678 的违章');
    assert.ok(s1.includes('ppo-traffic'), 'Must auto-select ppo-traffic for plate & passport violation check');

    const s2 = builtinSkills.autoSelect('这个埃及车牌有没有交通违章罚款？');
    assert.ok(s2.includes('ppo-traffic'), 'Must auto-select ppo-traffic for traffic violation question');

    // Follow-up
    const s3 = builtinSkills.autoSelect('再查一个: أ ف س 3413', {
        contextMessages: [{ role: 'user', content: '@ppo-traffic 查违章' }]
    });
    assert.ok(s3.includes('ppo-traffic'), 'Must maintain ppo-traffic on follow-up message');
});

test('ppo-traffic agent defines native tools and is accessible to all members', async () => {
    const defs = ppoAgent.definitions();
    assert.equal(defs.length, 3);
    const names = defs.map(d => d.name);
    assert.ok(names.includes('ppo_query_violations'));
    assert.ok(names.includes('ppo_check_status'));
    assert.ok(names.includes('ppo_query_history'));

    assert.equal(await ppoAgent.canUsePpo({ role: 'member' }), true, 'Must be accessible to all members');
    assert.equal(await ppoAgent.canUsePpo({ role: 'guest' }), true);

    // Tool registry
    assert.ok(agentToolRegistry.GROUPS['ppo-traffic']);
    assert.equal(agentToolAccess.DEFAULT_OFF_GROUPS.includes('ppo-traffic'), false, 'ppo-traffic must NOT be default-off');
});

test('ppo-traffic agent executes input validation correctly', async () => {
    // Missing plate number
    const r1 = await ppoAgent.execute('ppo_query_violations', { letters: 'أ ف س', number: '' });
    assert.equal(r1.isError, true);
    assert.match(r1.summary, /缺少车牌数字/);

    // Invalid letter count
    const r2 = await ppoAgent.execute('ppo_query_violations', { letters: 'أ', number: '3413' });
    assert.equal(r2.isError, true);
    assert.match(r2.summary, /车牌字母格式不正确/);

    // Missing document
    const r3 = await ppoAgent.execute('ppo_query_violations', { letters: 'أ ف س', number: '3413' });
    assert.equal(r3.isError, true);
    assert.match(r3.summary, /缺少车主证件信息/);
});

test('ppo_cli.py executes with python3 and outputs help', () => {
    const cliPath = path.resolve(__dirname, '../backend/agent-skills/ppo-traffic/scripts/ppo_cli.py');
    const out = execFileSync('python3', [cliPath, '--help'], { encoding: 'utf8' });
    assert.match(out, /PPO 埃及车辆违章查询 CLI/);
    assert.match(out, /query/);
    assert.match(out, /status/);
    assert.match(out, /history/);
});
