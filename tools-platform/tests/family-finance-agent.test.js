const test = require('node:test');
const assert = require('node:assert/strict');
const financeAgent = require('../backend/models/family-finance-agent');
const toolAccess = require('../backend/models/agent-tool-access');
const skillsStore = require('../backend/models/agent-skills-store');

test('family-finance-agent definitions and prompt satisfy contract', () => {
    const defs = financeAgent.definitions();
    assert.ok(Array.isArray(defs));
    assert.ok(defs.length >= 6);
    assert.ok(defs.some(d => d.name === 'finance_record_expense'));
    assert.ok(defs.some(d => d.name === 'finance_query_accounts'));

    const prompt = financeAgent.buildPrompt();
    assert.ok(typeof prompt === 'string' && prompt.includes('WISE 家庭财务记账助手'));
});

test('family-finance-agent blocks non-superadmin user from execution when unshared', async () => {
    const blockedOutcome = await financeAgent.execute('finance_query_accounts', {}, {
        user: { username: 'normal_user', role: 'developer', isSuper: false }
    });
    assert.equal(blockedOutcome.isError, true);
    assert.ok(blockedOutcome.content.includes('未向全员开放') || blockedOutcome.summary.includes('未开放'));
});

test('agent-tool-access denies finance tools for normal user by default', async () => {
    const canActorUse = await toolAccess.forActor({ username: 'normal_user', role: 'developer', isSuper: false }, 'team-xyz::normal_user');
    assert.equal(canActorUse('finance_record_expense'), false, 'finance tools must be denied for non-superadmin');
    assert.equal(canActorUse('finance_query_accounts'), false, 'finance tools must be denied for non-superadmin');

    const canSuperAdminUse = await toolAccess.forActor({ username: 'admin', role: 'admin', isSuper: true });
    assert.equal(canSuperAdminUse('finance_record_expense'), true, 'finance tools must be allowed for superadmin');
});

test('skillsStore listForUser isolates family-finance-bookkeeper from normal users', async () => {
    const superAdminSkills = await skillsStore.listForUser({ username: 'admin', role: 'admin', isSuper: true });
    const normalSkills = await skillsStore.listForUser({ username: 'normal_user', role: 'developer', isSuper: false });

    const superAdminFinance = superAdminSkills.find(s => s.id === 'family-finance-bookkeeper');
    const normalFinance = normalSkills.find(s => s.id === 'family-finance-bookkeeper');

    assert.ok(superAdminFinance, 'superadmin should see family-finance-bookkeeper');
    assert.equal(superAdminFinance.sharedAccess, false, 'should be marked as unshared (sharedAccess: false)');
    assert.equal(normalFinance, undefined, 'normal user must NOT see unshared family-finance-bookkeeper');
});
