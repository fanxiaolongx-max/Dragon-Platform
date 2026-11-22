const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'reward-program-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const db = require('../backend/models/app-db');
const { runWithTenant, getDataDir } = require('../backend/models/tenant-context');
const core = require('../backend/models/reward-program-core');
const repo = require('../backend/models/reward-program-repository');
const router = require('../backend/routes/reward-program');
test.after(async () => { await db.closeDatabase(); fs.rmSync(sandbox, { recursive: true, force: true }); });

function app() {
    const server = express();
    server.use(express.json());
    server.use((req, _res, next) => {
        const role = req.headers['x-role'] || 'user';
        const tenantId = req.headers['x-tenant'] || 'reward-a';
        req.user = { username: req.headers['x-user'] || (role === 'admin' ? 'admin' : 'alice'), role, tenantId };
        runWithTenant(tenantId, next);
    });
    server.use('/api/reward-program', router);
    return server;
}
const bounty = {
    category: 'bounty', ruleId: 'bounty-project', title: '项目攻坚', projectName: 'Egypt 5G', summary: '完成重大项目交付', totalAmountMinor: 10000,
    teams: [
        { name: '交付组', mode: 'percent', percentBp: 6000, members: [{ name: '张三', mode: 'amount', amountMinor: 4000 }, { name: '李四', mode: 'amount', amountMinor: 2000 }] },
        { name: '保障组', mode: 'amount', amountMinor: 4000, members: [{ name: '王五', mode: 'percent', percentBp: 10000 }] }
    ]
};

test('bounty amounts reconcile across teams and people; invalid amounts are rejected', () => {
    const valid = core.normalizeApplication(bounty, require('../backend/builtin-tools/reward-program/default-rules.json'));
    assert.equal(valid.teams[0].amountMinor, 6000);
    assert.equal(valid.teams[1].members[0].amountMinor, 4000);
    assert.throws(() => core.normalizeApplication({ ...bounty, teams: [{ ...bounty.teams[0], members: [{ name: '张三', mode: 'amount', amountMinor: 5000 }] }, bounty.teams[1]] }, require('../backend/builtin-tools/reward-program/default-rules.json')), /成员分配合计/);
    assert.throws(() => core.normalizeApplication({ ...bounty, totalAmountMinor: 10001 }, require('../backend/builtin-tools/reward-program/default-rules.json')), /分配合计/);
    assert.throws(() => core.normalizeApplication({ ...bounty, teams: [{ ...bounty.teams[0], members: [{ name: '张三', staffId: '123', mode: 'amount', amountMinor: 4000 }, { name: '李四', staffId: '123', mode: 'amount', amountMinor: 2000 }] }, bounty.teams[1]] }, require('../backend/builtin-tools/reward-program/default-rules.json')), /同一工号/);
});

test('applications stay tenant-scoped and enforce ownership, revision, approval order and disclosure', async () => {
    const server = app(), base = '/api/reward-program';
    const created = (await request(server).post(base + '/applications').send(bounty).expect(201)).body;
    assert.equal(created.status, 'draft');
    await request(server).post(`${base}/applications/${created.id}/save`).set('x-user', 'bob').send({ ...bounty, revision: 1 }).expect(404);
    await request(server).post(`${base}/applications/${created.id}/submit`).send({ ...bounty, totalAmountMinor: 10001, revision: 1 }).expect(400);
    const submitted = (await request(server).post(`${base}/applications/${created.id}/submit`).send({ ...bounty, revision: 1 }).expect(200)).body;
    assert.equal(submitted.status, 'submitted');
    assert.equal(submitted.ruleSnapshot.id, 'bounty-project');
    await request(server).post(`${base}/applications/${created.id}/submit`).send({ ...bounty, revision: 1 }).expect(409);
    await request(server).post(`${base}/applications/${created.id}/decision`).send({ action: 'approve', revision: 2 }).expect(403);
    const admin = { 'x-role': 'admin' };
    let current = (await request(server).post(`${base}/applications/${created.id}/decision`).set(admin).send({ action: 'approve', revision: 2 }).expect(200)).body;
    assert.equal(current.status, 'department_approved');
    await request(server).post(`${base}/applications/${created.id}/decision`).set(admin).send({ action: 'approve', revision: 3 }).expect(400);
    current = (await request(server).post(`${base}/applications/${created.id}/decision`).set(admin).send({ action: 'approve', revision: 3, note: 'AT 会议同意' }).expect(200)).body;
    assert.equal(current.status, 'at_approved');
    current = (await request(server).post(`${base}/applications/${created.id}/decision`).set(admin).send({ action: 'approve', revision: 4 }).expect(200)).body;
    assert.equal(current.status, 'publicity');
    const publicList = (await request(server).get(base).set('x-user', 'bob').expect(200)).body.applications;
    assert.equal(publicList.length, 1);
    assert.equal(publicList[0].totalAmountMinor, undefined);
    assert.equal(publicList[0].teams[0].members[0].name, '张三');
    const objection = (await request(server).post(`${base}/applications/${created.id}/objections`).set('x-user', 'bob').send({ note: '获奖名单中姓名需核对' }).expect(201)).body;
    await request(server).post(`${base}/applications/${created.id}/decision`).set(admin).send({ action: 'approve', revision: 5 }).expect(409);
    const visibleObjections = (await request(server).get(`${base}/applications/${created.id}/objections`).set('x-user', 'bob').expect(200)).body;
    assert.equal(visibleObjections.length, 1);
    await request(server).post(`${base}/applications/${created.id}/objections/${objection.id}/resolve`).set('x-user', 'bob').send({ resolution: '通过' }).expect(403);
    await request(server).post(`${base}/applications/${created.id}/objections/${objection.id}/resolve`).set(admin).send({ resolution: '核查后确认名单无误' }).expect(200);
    current = (await request(server).post(`${base}/applications/${created.id}/decision`).set(admin).send({ action: 'approve', revision: 5 }).expect(200)).body;
    assert.equal(current.status, 'completed');
    assert.deepEqual((await request(server).get(base).set('x-user', 'bob').expect(200)).body.applications, []);
    await request(server).get(`${base}/applications/${created.id}/events`).set('x-user', 'bob').expect(404);
    assert.deepEqual((await request(server).get(base).set('x-tenant', 'reward-b').expect(200)).body.applications, []);
    assert.deepEqual(await runWithTenant('reward-b', () => repo.listApplications('admin', true)), []);
});

test('position incentives require a configured fixed role and amount', async () => {
    const server = app(), base = '/api/reward-program';
    const payload = { category: 'position', ruleId: 'position-fixed', title: '9 月岗位激励', summary: '承担固定岗位职责', totalAmountMinor: 50000, recipients: [{ name: '张三', mode: 'amount', amountMinor: 50000 }] };
    const draft = (await request(server).post(base + '/applications').set('x-user', 'admin').send(payload).expect(201)).body;
    await request(server).post(`${base}/applications/${draft.id}/submit`).set('x-user', 'admin').send({ ...payload, revision: 1 }).expect(400);
    await request(server).put(`${base}/rules/position-fixed`).set('x-user', 'admin').set('x-role', 'admin').send({ category: 'position', name: '值班岗位激励', positionName: '值班工程师', cycle: '月度', unitAmountMinor: 50000, approvalFlow: ['department', 'at'] }).expect(200);
    await request(server).put(`${base}/rules/position-fixed`).set('x-user', 'admin').set('x-role', 'admin').send({ category: 'position', name: '值班岗位激励', positionName: '值班工程师', cycle: '月度', unitAmountMinor: 50000, approvalFlow: ['department', 'publicity', 'at'] }).expect(400);
    const submitted = (await request(server).post(`${base}/applications/${draft.id}/submit`).set('x-user', 'admin').send({ ...payload, revision: 1 }).expect(200)).body;
    assert.equal(submitted.ruleSnapshot.positionName, '值班工程师');
    assert.equal(submitted.ruleSnapshot.unitAmountMinor, 50000);
});

test('simplified workflow: draft -> publish -> revoke -> archive -> unarchive and delete draft', async () => {
    const server = app(), base = '/api/reward-program', admin = { 'x-role': 'admin' };
    const payload = {
        category: 'bounty', ruleId: 'bounty-project', title: '极简流转测试', projectName: 'FastTrack', summary: '快速交付', totalAmountMinor: 10000,
        teams: [{ name: '交付组', mode: 'amount', amountMinor: 10000, members: [{ name: '张三', mode: 'amount', amountMinor: 10000 }] }]
    };
    // 1. Create draft
    const draft = (await request(server).post(base + '/applications').send(payload).expect(201)).body;
    assert.equal(draft.status, 'draft');

    // 2. Publish draft
    const published = (await request(server).post(`${base}/applications/${draft.id}/publish`).send({ ...payload, revision: 1 }).expect(200)).body;
    assert.equal(published.status, 'published');

    // 3. Revoke
    const revoked = (await request(server).post(`${base}/applications/${draft.id}/revoke`).set(admin).send({ reason: '申报信息有误撤回', revision: 2 }).expect(200)).body;
    assert.equal(revoked.status, 'revoked');
    assert.equal(revoked.revokeReason, '申报信息有误撤回');

    // 4. Archive
    const archived = (await request(server).post(`${base}/applications/${draft.id}/archive`).set(admin).send({ revision: 3 }).expect(200)).body;
    assert.equal(archived.status, 'archived');

    // 5. Unarchive
    const unarchived = (await request(server).post(`${base}/applications/${draft.id}/unarchive`).set(admin).send({ revision: 4 }).expect(200)).body;
    assert.equal(unarchived.status, 'revoked'); // restored to previousStatus

    // 6. Test delete draft
    const draft2 = (await request(server).post(base + '/applications').send(payload).expect(201)).body;
    assert.equal(draft2.status, 'draft');
    await request(server).delete(`${base}/applications/${draft2.id}`).expect(200);
    await request(server).get(`${base}/applications/${draft2.id}/events`).expect(404);

    // 7. Test CNY currency support
    const cnyPayload = { ...payload, currency: 'CNY', totalAmountMinor: 50000, teams: [{ name: '交付组', mode: 'amount', amountMinor: 50000, members: [{ name: '张三', mode: 'amount', amountMinor: 50000 }] }] };
    const cnyDraft = (await request(server).post(base + '/applications').send(cnyPayload).expect(201)).body;
    assert.equal(cnyDraft.currency, 'CNY');
    const cnyPublished = (await request(server).post(`${base}/applications/${cnyDraft.id}/publish`).send({ ...cnyPayload, revision: 1 }).expect(200)).body;
    assert.equal(cnyPublished.currency, 'CNY');
});

test('evidence upload and attachments support for applications', async () => {
    const server = app(), base = '/api/reward-program';
    // 1. Upload evidence file
    const uploadRes = await request(server)
        .post(`${base}/evidence`)
        .attach('file', Buffer.from('test screenshot content'), 'proof.png')
        .expect(200);
    assert(uploadRes.body.path.startsWith('/api/reward-program/evidence/'));
    assert.equal(uploadRes.body.filename, 'proof.png');

    // 2. Fetch uploaded evidence
    await request(server).get(uploadRes.body.path).expect(200);

    // 3. Create application with attachments
    const payload = {
        category: 'bounty',
        ruleId: 'bounty-project',
        title: '附带证据材料的奖励申报',
        period: '2026年9月',
        projectName: '安全加固专项',
        summary: '完成核心模块重构与测试',
        evidence: '见附件证据截图',
        attachments: [uploadRes.body.path],
        totalAmountMinor: 10000,
        teams: [{ name: '安全组', mode: 'amount', amountMinor: 10000, members: [{ name: '李四', mode: 'amount', amountMinor: 10000 }] }]
    };
    const draft = (await request(server).post(base + '/applications').send(payload).expect(201)).body;
    assert.equal(draft.attachments.length, 1);
    assert.equal(draft.attachments[0], uploadRes.body.path);

    // 4. Publish application with attachments
    const published = (await request(server).post(`${base}/applications/${draft.id}/publish`).send({ ...payload, revision: 1 }).expect(200)).body;
    assert.equal(published.attachments.length, 1);
    assert.equal(published.attachments[0], uploadRes.body.path);
});

test('rules support CNY currency, creation, deletion by admin, and usage isolation', async () => {
    const server = app(), base = '/api/reward-program', admin = { 'x-role': 'admin' };

    // 1. Create a rule with CNY currency and reference budget
    const ruleId = 'custom-cny-award';
    const cnyRulePayload = {
        category: 'excellence',
        name: 'CNY卓越贡献奖',
        cycle: '年度',
        currency: 'CNY',
        referenceBudgetMinor: 5000000,
        unitAmountMinor: null,
        criteria: '重大贡献专项奖励',
        approvalFlow: ['department', 'at', 'publicity']
    };

    // Non-admin cannot save rule
    await request(server).put(`${base}/rules/${ruleId}`).send(cnyRulePayload).expect(403);

    // Admin saves rule
    const savedRule = (await request(server).put(`${base}/rules/${ruleId}`).set(admin).send(cnyRulePayload).expect(200)).body;
    assert.equal(savedRule.currency, 'CNY');
    assert.equal(savedRule.referenceBudgetMinor, 5000000);

    // Verify rule appears in rules list with CNY
    const listRes = (await request(server).get(base).expect(200)).body;
    const foundRule = listRes.rules.find(r => r.id === ruleId);
    assert(foundRule);
    assert.equal(foundRule.currency, 'CNY');

    // 2. Create and publish an application using this rule
    const appPayload = {
        category: 'excellence',
        ruleId,
        title: 'CNY 奖励测试项目',
        currency: 'CNY',
        summary: '完成专项交付',
        totalAmountMinor: 5000000,
        recipients: [{ name: '王五', mode: 'amount', amountMinor: 5000000 }]
    };
    const appDraft = (await request(server).post(`${base}/applications`).send(appPayload).expect(201)).body;
    assert.equal(appDraft.ruleId, ruleId);
    assert.equal(appDraft.currency, 'CNY');

    const appPublished = (await request(server).post(`${base}/applications/${appDraft.id}/publish`).send({ ...appPayload, revision: 1 }).expect(200)).body;
    assert.equal(appPublished.ruleId, ruleId);
    assert.equal(appPublished.ruleSnapshot.currency, 'CNY');
    assert.equal(appPublished.ruleSnapshot.referenceBudgetMinor, 5000000);

    // 3. Non-admin cannot delete rule
    await request(server).delete(`${base}/rules/${ruleId}`).expect(403);

    // Admin deletes custom rule
    await request(server).delete(`${base}/rules/${ruleId}`).set(admin).expect(200);

    // Verify custom rule is deleted from list
    const afterDelList = (await request(server).get(base).expect(200)).body;
    assert(!afterDelList.rules.some(r => r.id === ruleId));

    // Historical application still exists with its snapshot
    const fetchedApp = (await request(server).get(base).expect(200)).body.applications.find(a => a.id === appDraft.id);
    assert(fetchedApp);
    assert.equal(fetchedApp.ruleId, ruleId);
    assert.equal(fetchedApp.ruleSnapshot.name, 'CNY卓越贡献奖');
    assert.equal(fetchedApp.ruleSnapshot.currency, 'CNY');

    // 4. Admin deletes a default rule (e.g. ex-youth)
    const defaultRuleId = 'ex-youth';
    assert((await request(server).get(base).expect(200)).body.rules.some(r => r.id === defaultRuleId));
    await request(server).delete(`${base}/rules/${defaultRuleId}`).set(admin).expect(200);
    const afterDefaultDel = (await request(server).get(base).expect(200)).body;
    assert(!afterDefaultDel.rules.some(r => r.id === defaultRuleId));
});

test('archived applications can be permanently deleted by admin, including evidence files and batch clearing', async () => {
    const server = app(), base = '/api/reward-program', admin = { 'x-role': 'admin' };

    // 1. Upload evidence file
    const uploadRes = await request(server)
        .post(`${base}/evidence`)
        .attach('file', Buffer.from('test-evidence-content'), 'archived-evidence.pdf')
        .expect(200);
    const attachmentPath = uploadRes.body.path;
    const attachmentFilename = path.basename(attachmentPath);

    // Verify attachment file exists on disk
    const tenantDir = path.join(getDataDir('reward-a'), 'reward-program-evidence');
    assert.equal(fs.existsSync(path.join(tenantDir, attachmentFilename)), true);

    // 2. Create application with evidence and publish then archive
    const payload = {
        category: 'bounty',
        ruleId: 'bounty-project',
        title: '归档删除测试项目',
        summary: '用于测试彻底删除已归档记录',
        projectName: '埃及5G工程交付',
        totalAmountMinor: 10000,
        attachments: [attachmentPath],
        teams: [{ name: '交付组', mode: 'amount', amountMinor: 10000, members: [{ name: '张三', mode: 'amount', amountMinor: 10000 }] }]
    };
    const draft = (await request(server).post(`${base}/applications`).send(payload).expect(201)).body;
    await request(server).post(`${base}/applications/${draft.id}/publish`).send({ ...payload, revision: 1 }).expect(200);
    const archived = (await request(server).post(`${base}/applications/${draft.id}/archive`).set(admin).send({ revision: 2 }).expect(200)).body;
    assert.equal(archived.status, 'archived');

    // 3. Non-admin cannot delete archived record
    await request(server).delete(`${base}/applications/${draft.id}`).expect(403);

    // 4. Admin permanently deletes archived record
    const delRes = (await request(server).delete(`${base}/applications/${draft.id}`).set(admin).expect(200)).body;
    assert.equal(delRes.deleted, true);

    // 5. Verify record and events are completely deleted from DB
    await request(server).get(`${base}/applications/${draft.id}/events`).expect(404);
    const listRes = (await request(server).get(base).expect(200)).body;
    assert.equal(listRes.applications.some(a => a.id === draft.id), false);

    // 6. Verify evidence attachment file is removed from disk
    assert.equal(fs.existsSync(path.join(tenantDir, attachmentFilename)), false);

    // 7. Test batch clear archived records
    const draftA = (await request(server).post(`${base}/applications`).send({ ...payload, title: '归档批量删除A' }).expect(201)).body;
    const draftB = (await request(server).post(`${base}/applications`).send({ ...payload, title: '归档批量删除B' }).expect(201)).body;
    await request(server).post(`${base}/applications/${draftA.id}/publish`).send({ ...payload, title: '归档批量删除A', revision: 1 }).expect(200);
    await request(server).post(`${base}/applications/${draftB.id}/publish`).send({ ...payload, title: '归档批量删除B', revision: 1 }).expect(200);
    await request(server).post(`${base}/applications/${draftA.id}/archive`).set(admin).send({ revision: 2 }).expect(200);
    await request(server).post(`${base}/applications/${draftB.id}/archive`).set(admin).send({ revision: 2 }).expect(200);

    // Non-admin cannot batch clear
    await request(server).delete(`${base}/archived`).expect(403);

    // Admin batch clears archived records
    const clearRes = (await request(server).delete(`${base}/archived?category=bounty`).set(admin).expect(200)).body;
    assert.equal(clearRes.success, true);
    assert.ok(clearRes.count >= 2);

    // Verify all archived bounty records are cleared
    const afterClearList = (await request(server).get(base).expect(200)).body;
    assert.equal(afterClearList.applications.some(a => a.status === 'archived' && a.category === 'bounty'), false);
});


