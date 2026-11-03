const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'reward-penalty-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report');
const db = require('../backend/models/app-db');
const { runWithTenant } = require('../backend/models/tenant-context');
const repo = require('../backend/models/department-reward-penalty-repository');
const express = require('express');
const request = require('supertest');
const router = require('../backend/routes/department-reward-penalty');
test.after(async () => { await db.closeDatabase(); fs.rmSync(sandbox, { recursive: true, force: true }); });

test('default rules exclude personal data; writes and audit remain tenant isolated', async () => {
    const initial = await repo.list();
    assert.equal(initial.rules.length, 55);
    assert.deepEqual(initial.personnel, []);
    assert.deepEqual(initial.records, []);
    assert.deepEqual((await repo.listAudit()).rows, []);

    await repo.put('personnel', 'P-1', { name: 'Test Person', role: 'MTD' }, 'admin', '保存');
    await repo.put('personnel', 'P-1', { name: 'Changed Person', role: 'MTD' }, 'admin', '修改', '校正姓名');
    const own = await repo.list();
    assert.equal(own.personnel[0].name, 'Changed Person');
    const audit = await repo.listAudit({ page: 1, pageSize: 1 });
    assert.equal(audit.total, 2);
    assert.equal(audit.rows[0].actor, 'admin');
    assert.equal(audit.rows[0].before.name, 'Test Person');
    assert.equal(audit.rows[0].after.name, 'Changed Person');
    assert.equal(audit.rows[0].reason, '校正姓名');
    await repo.put('roles', 'New Role', { value: 'New Role' }, 'admin');
    assert.ok((await repo.list()).roles.some(item => item.value === 'MTD'));
    assert.ok((await repo.list()).roles.some(item => item.value === 'New Role'));

    await runWithTenant('other', async () => {
        const isolated = await repo.list();
        assert.equal(isolated.rules.length, 55);
        assert.deepEqual(isolated.personnel, []);
        assert.deepEqual((await repo.listAudit()).rows, []);
        await repo.put('personnel', 'P-2', { name: 'Other Tenant', role: 'TE' }, 'admin');
    });
    assert.deepEqual((await repo.list()).personnel.map(item => item.id), ['P-1']);
});

test('record API checks roles, requires a publish reason, and keeps rule snapshots', async t => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = req.headers['x-test-role'] === 'user' ? { username: 'reporter', role: 'user' } : { username: 'admin', role: 'admin' }; next(); });
    app.use('/api/department-reward-penalty', router);
    const server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    const base = '/api/department-reward-penalty';
    const group = await request(server).post(base + '/config/customerGroups').send({ value: '客户群 A' }).expect(200);
    const anotherGroup = await request(server).post(base + '/config/customerGroups').send({ value: '客户群 B' }).expect(200);
    await request(server).post(base + '/personnel').send({ id: 'TEST-MTD', name: 'Reviewer', role: 'MTD' }).expect(400);
    await request(server).post(base + '/personnel').send({ id: 'TEST-MTD', name: 'Reviewer', role: 'MTD', customerGroupId: group.body.id }).expect(200);
    await request(server).post(base + '/personnel').send({ id: 'TEST-TE', name: 'Engineer', role: 'TE', customerGroupId: anotherGroup.body.id }).expect(200);
    const draft = { id: 'test-record', date: '2026-09-17', customerGroupId: group.body.id, staffId: 'TEST-MTD', ruleId: 'R04', deduct: '1 Month/Time', remark: 'Test' };
    await request(server).post(base + '/records').send({ ...draft, date: '2026-02-30' }).expect(400);
    await request(server).post(base + '/records').send({ ...draft, staffId: 'TEST-TE' }).expect(400);
    const mismatch = await request(server).post(base + '/records').send({ ...draft, staffId: 'TEST-TE', customerGroupId: anotherGroup.body.id }).expect(400);
    assert.match(mismatch.body.error, /MTD/);
    await request(server).post(base + '/records').send({ ...draft, deduct: '1 Quarter/Time' }).expect(400);
    await request(server).post(base + '/records').set('x-test-role', 'user').send(draft).expect(200);
    await request(server).post(base + '/records').set('x-test-role', 'user').send({ ...draft, action: 'publish', reason: 'Attempt' }).expect(403);
    await request(server).post(base + '/rules').set('x-test-role', 'user').send({ id: 'bad' }).expect(403);
    await request(server).post(base + '/records').send({ ...draft, action: 'publish' }).expect(400);
    const published = await request(server).post(base + '/records').send({ ...draft, action: 'publish', reason: 'Reviewed evidence' }).expect(200);
    assert.equal(published.body.status, 'published');
    assert.equal(published.body.ruleSnapshot.desc, '整改未在支持要求的时间内完成（包括延期）');
    await request(server).post(base + '/records').send({ ...draft, remark: 'Late edit' }).expect(400);
    await request(server).post(base + '/records').send({ id: draft.id, action: 'revoke', reason: 'Incorrect finding' }).expect(403);
    await request(server).post(base + '/records').send({ id: draft.id, action: 'revoke', pin: 'wrong', reason: 'Incorrect finding' }).expect(403);
    const revoked = await request(server).post(base + '/records').send({ id: draft.id, action: 'revoke', pin: '0000', reason: 'Incorrect finding' }).expect(200);
    assert.equal(revoked.body.status, 'revoked');
    const state = await request(server).get(base).expect(200);
    await request(server).get(base + '/audit').set('x-test-role', 'user').expect(403);
    const auditPage = await request(server).get(base + '/audit?page=1&pageSize=2').expect(200);
    assert.equal(auditPage.body.rows.length, 2);
    assert.ok(auditPage.body.total > 2);
    assert.equal(auditPage.body.rows.find(item => item.action === '撤销已发布违规').reason, 'Incorrect finding');
    const lastPage = await request(server).get(base + '/audit?page=999&pageSize=2').expect(200);
    assert.equal(lastPage.body.page, lastPage.body.totalPages);
    const uploaded = await request(server).post(base + '/evidence').attach('file', Buffer.from('%PDF-1.4\n% test'), { filename: 'proof.pdf', contentType: 'application/pdf' }).expect(200);
    assert.match(uploaded.body.path, /^\/api\/department-reward-penalty\/evidence\/[a-f0-9-]+\.pdf$/);
    await request(server).get(uploaded.body.path).expect(200);
});

test('evidence remains tenant-isolated and Chinese role matching does not allow cross-role records', async () => {
    const app = express();
    const primaryTenant = 'role-evidence-test';
    app.use(express.json());
    app.use((req, _res, next) => {
        const tenantId = req.headers['x-test-tenant'] || primaryTenant;
        req.user = { username: 'admin', role: 'admin', tenantId };
        runWithTenant(tenantId, next);
    });
    app.use('/api/department-reward-penalty', router);
    const base = '/api/department-reward-penalty';

    const uploaded = await request(app)
        .post(base + '/evidence')
        .attach('file', Buffer.from('tenant-only'), { filename: 'proof.txt', contentType: 'text/plain' })
        .expect(200);
    await request(app).get(uploaded.body.path).expect(200);
    await request(app).get(uploaded.body.path).set('x-test-tenant', 'other-evidence-tenant').expect(404);

    const group = (await request(app).post(base + '/config/customerGroups').send({ value: '中文角色客户群' }).expect(200)).body;
    await request(app).post(base + '/config/roles').send({ value: '客服' }).expect(200);
    await request(app).post(base + '/config/roles').send({ value: '技术' }).expect(200);
    await request(app).post(base + '/personnel').send({ id: 'CN-ROLE-1', name: '中文角色人员', role: '客服', customerGroupId: group.id }).expect(200);
    const rule = (await request(app).post(base + '/rules').send({ id: 'CN-RULE-1', svcModule: '测试', subModule: '角色', desc: '仅技术适用', roles: ['技术'], deduct: '1 Month/Time', weight: null }).expect(200)).body;
    await request(app).post(base + '/records').send({ id: 'CN-RECORD-1', date: '2026-09-20', customerGroupId: group.id, staffId: 'CN-ROLE-1', ruleId: rule.id }).expect(400);
});

test('legacy import moves browser records into a separate tenant without bundling people', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { username: 'admin', role: 'admin' }; runWithTenant('import-test', next); });
    app.use('/api/department-reward-penalty', router);
    const legacy = {
        personnel: [{ id: 'P-9', name: 'Legacy Person', role: 'MTD' }],
        rules: [{ id: 'R04', svcModule: 'Risk', subModule: '整改', desc: '逾期', roles: 'MTD', deduct: '1 Month/Time', weight: '10%' }],
        records: [{ id: 'OLD-1', status: '已发布', date: '2026-08-01', staffId: 'P-9', ruleId: 'R04', deduct: '1 Month/Time', tt: 'T-1', remark: '历史记录' }]
    };
    await request(app).post('/api/department-reward-penalty/legacy-import').send(legacy).expect(200);
    const imported = await request(app).get('/api/department-reward-penalty').expect(200);
    assert.equal(imported.body.personnel[0].name, 'Legacy Person');
    assert.equal(imported.body.records[0].status, 'published');
    assert.equal(imported.body.records[0].ruleSnapshot.desc, '逾期');
    const amended = await request(app).post('/api/department-reward-penalty/records/OLD-1/force-edit').send({ ...imported.body.records[0], remark: '历史备注修正', pin: '0000', reason: '历史信息校正' }).expect(200);
    assert.equal(amended.body.status, 'published');
    assert.equal(amended.body.remark, '历史备注修正');
    assert.equal(amended.body.customerGroupId, '');
    const legacyBackup = await request(app).get('/api/department-reward-penalty/backup/export-json').expect(200);
    await request(app).post('/api/department-reward-penalty/backup/inspect').send(JSON.parse(legacyBackup.text)).expect(200);
    await request(app).post('/api/department-reward-penalty/legacy-import').send(legacy).expect(409);
});

test('historical FME duty can be corrected one migrated record at a time with PIN and audit', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = req.headers['x-test-role'] === 'user' ? { username: 'reporter', role: 'user' } : { username: 'admin', role: 'admin' };
        runWithTenant('historical-role-correction-test', next);
    });
    app.use('/api/department-reward-penalty', router);
    const base = '/api/department-reward-penalty';
    await request(app).post(base + '/legacy-import').send({
        personnel: [{ id: 'W-1', name: '已核实 FME', role: 'MS' }, { id: 'W-2', name: '尚未核实', role: 'MS' }],
        rules: [],
        records: ['PUB-17', 'PUB-18'].map((id, index) => ({ id, status: '已发布', date: '2026-06-30', staffId: index ? 'W-2' : 'W-1', ruleId: 'R44', deduct: '1 Month/Time' }))
    }).expect(200);
    const path = base + '/records/PUB-17/correct-historical-role';
    const body = { expectedRole: 'MS', role: 'fme', reason: '经原始职责材料核实，发生时承担 FME 职责', pin: '0000' };
    await request(app).post(path).set('x-test-role', 'user').send(body).expect(403);
    await request(app).post(path).send({ ...body, role: 'TE' }).expect(400);
    await request(app).post(path).send({ ...body, reason: '' }).expect(400);
    await request(app).post(path).send({ ...body, pin: 'wrong' }).expect(403);
    const corrected = (await request(app).post(path).send(body).expect(200)).body;
    assert.equal(corrected.personSnapshot.role, 'FME');
    assert.deepEqual(corrected.personSnapshot.roles, ['FME']);
    assert.equal(corrected.migrationWarning, false);
    assert.equal(corrected.ruleId, 'R44');
    assert.equal(corrected.status, 'published');
    assert.equal(corrected.historicalRoleCorrection.from, 'MS');
    await request(app).post(path).send(body).expect(409);
    const state = (await request(app).get(base).expect(200)).body;
    assert.equal(state.records.find(item => item.id === 'PUB-18').personSnapshot.role, 'MS');
    assert.equal(state.records.find(item => item.id === 'PUB-18').migrationWarning, true);
    assert.equal(state.personnel.find(item => item.id === 'W-1').role, 'MS');
    const audit = (await request(app).get(base + '/audit').expect(200)).body;
    assert.ok(audit.rows.some(row => row.action === '更正迁移记录历史角色' && row.item_id === 'PUB-17' && row.before.personSnapshot.role === 'MS' && row.after.personSnapshot.role === 'FME'));
    assert.equal(JSON.stringify(audit).includes('0000'), false);
});

test('configuration CRUD updates references, blocks used deletion, and paginates audit', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { username: 'admin', role: 'admin' }; runWithTenant('config-test', next); });
    app.use('/api/department-reward-penalty', router);
    const base = '/api/department-reward-penalty';
    const group = (await request(app).post(base + '/config/customerGroups').send({ value: '群一' }).expect(200)).body;
    const role = (await request(app).post(base + '/config/roles').send({ value: '新角色' }).expect(200)).body;
    const category = (await request(app).post(base + '/config/deductionCategories').send({ value: '专项' }).expect(200)).body;
    await request(app).post(base + '/config/deductions').send({ value: '无分类扣罚' }).expect(400);
    const deduction = (await request(app).post(base + '/config/deductions').send({ value: '新扣罚', categoryId: category.id }).expect(200)).body;
    await request(app).post(base + '/personnel').send({ id: 'P-1', name: '人员', role: role.value, customerGroupId: group.id }).expect(200);
    await request(app).post(base + '/rules').send({ id: 'TEST-RULE', svcModule: '大类', subModule: '子类', desc: '违规', roles: [role.value], deduct: deduction.value, weight: null }).expect(200);
    await request(app).delete(base + '/config/roles/' + role.id).expect(409);
    await request(app).delete(base + '/config/deductions/' + deduction.id).expect(409);
    await request(app).delete(base + '/config/deductionCategories/' + category.id).expect(409);
    await request(app).delete(base + '/config/customerGroups/' + group.id).expect(409);
    await request(app).put(base + '/config/roles/' + role.id).send({ value: '新角色二' }).expect(200);
    await request(app).put(base + '/config/deductions/' + deduction.id).send({ value: '新扣罚二' }).expect(200);
    await request(app).put(base + '/config/customerGroups/' + group.id).send({ value: '群二' }).expect(200);
    const state = (await request(app).get(base).expect(200)).body;
    assert.equal(state.personnel[0].role, '新角色二');
    assert.equal(state.personnel[0].customerGroupId, group.id);
    assert.deepEqual(state.rules.find(item => item.id === 'TEST-RULE').roles, ['新角色二']);
    assert.equal(state.rules.find(item => item.id === 'TEST-RULE').deduct, '新扣罚二');
    assert.equal(state.deductions.find(item => item.id === deduction.id).categoryId, category.id);
    assert.equal(state.customerGroups[0].value, '群二');
    const audit = (await request(app).get(base + '/audit?page=2&pageSize=3').expect(200)).body;
    assert.equal(audit.page, 2);
    assert.equal(audit.rows.length, 3);
});

test('one person can hold multiple groups and roles while records bind to one selected group', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { username: 'admin', role: 'admin' }; runWithTenant('multi-person-test', next); });
    app.use('/api/department-reward-penalty', router);
    const base = '/api/department-reward-penalty';
    const a = (await request(app).post(base + '/config/customerGroups').send({ value: 'A' }).expect(200)).body;
    const b = (await request(app).post(base + '/config/customerGroups').send({ value: 'B' }).expect(200)).body;
    await request(app).post(base + '/personnel').send({ id: 'MULTI-1', name: '多角色人员', roles: ['TE', 'MTD'], customerGroupIds: [a.id, b.id] }).expect(200);
    const person = (await request(app).get(base).expect(200)).body.personnel[0];
    assert.deepEqual(person.roles, ['TE', 'MTD']);
    assert.deepEqual(person.customerGroupIds, [a.id, b.id]);
    const draft = { id: 'multi-record', date: '2026-09-17', staffId: person.id, customerGroupId: b.id, ruleId: 'R04' };
    const recorded = await request(app).post(base + '/records').send(draft).expect(200);
    assert.equal(recorded.body.deduct, '1 Month/Time');
    assert.equal(recorded.body.customerGroupId, b.id);
    await request(app).post(base + '/records').send({ ...draft, id: 'bad-group', customerGroupId: 'unknown' }).expect(400);
    await request(app).post(base + '/records').send({ ...draft, id: 'bad-deduction', deduct: 'Custom' }).expect(400);
    await request(app).delete(base + '/config/customerGroups/' + b.id).expect(409);
    await request(app).delete(base + '/config/roles/MTD').expect(409);
});

test('BU assignment and forced published-record edits are tenant-scoped and audited without leaking PINs', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = req.headers['x-test-role'] === 'user' ? { username: 'reporter', role: 'user' } : { username: 'admin', role: 'admin' }; runWithTenant(req.headers['x-test-tenant'] || 'force-edit-test', next); });
    app.use('/api/department-reward-penalty', router);
    const base = '/api/department-reward-penalty';
    const unitA = (await request(app).post(base + '/config/businessUnits').send({ value: 'BU A' }).expect(200)).body;
    const unitB = (await request(app).post(base + '/config/businessUnits').send({ value: 'BU B' }).expect(200)).body;
    const group = (await request(app).post(base + '/config/customerGroups').send({ value: '客户群' }).expect(200)).body;
    await request(app).post(base + '/personnel').send({ id: 'BU-1', name: '人员', roles: ['MTD'], customerGroupIds: [group.id], businessUnitIds: [unitA.id, unitB.id] }).expect(200);
    await request(app).post(base + '/personnel').send({ id: 'BU-2', name: '第二责任人', roles: ['MTD'], customerGroupIds: [group.id], businessUnitIds: [unitB.id] }).expect(200);
    let state = (await request(app).get(base).expect(200)).body;
    assert.deepEqual(state.personnel[0].businessUnitIds, [unitA.id, unitB.id]);
    await request(app).delete(base + '/config/businessUnits/' + unitA.id).expect(409);
    const draft = { id: 'PUBLISHED-1', date: '2026-09-17', staffId: 'BU-1', customerGroupId: group.id, ruleId: 'R04', remark: '原备注' };
    await request(app).post(base + '/records').send({ ...draft, action: 'publish', reason: '核准' }).expect(200);
    await request(app).post(base + '/records/PUBLISHED-1/force-edit').set('x-test-role', 'user').send({ ...draft, pin: '0000', reason: '修正' }).expect(403);
    await request(app).post(base + '/records/PUBLISHED-1/force-edit').send({ ...draft, pin: '9999', reason: '修正' }).expect(403);
    await request(app).post(base + '/records/PUBLISHED-1/force-edit').send({ ...draft, pin: '0000' }).expect(400);
    const updated = (await request(app).post(base + '/records/PUBLISHED-1/force-edit').send({ ...draft, pin: '0000', reason: '修正误录', remark: '新备注' }).expect(200)).body;
    assert.equal(updated.status, 'published');
    assert.equal(updated.remark, '新备注');
    assert.equal(updated.forcedEditReason, '修正误录');
    assert.equal(updated.publishedBy, 'admin');
    const reassigned = (await request(app).post(base + '/records/PUBLISHED-1/force-edit').send({ ...draft, staffId: 'BU-2', pin: '0000', reason: '更正责任人' }).expect(200)).body;
    assert.equal(reassigned.businessUnitId, unitB.id);
    assert.equal(reassigned.personSnapshot.businessUnitId, unitB.id);
    await request(app).put(base + '/security/pin').send({ currentPin: '0000', newPin: '123456' }).expect(200);
    await request(app).post(base + '/records/PUBLISHED-1/force-edit').send({ ...draft, pin: '0000', reason: '旧口令' }).expect(403);
    await request(app).post(base + '/records/PUBLISHED-1/force-edit').send({ ...draft, pin: '123456', reason: '再次修正', remark: '再次修改' }).expect(200);
    state = (await request(app).get(base).expect(200)).body;
    assert.equal(JSON.stringify(state).includes('123456'), false);
    const audit = (await request(app).get(base + '/audit').expect(200)).body;
    assert.ok(audit.rows.some(row => row.action === '强制修改已发布违规'));
    assert.equal(JSON.stringify(audit).includes('123456'), false);
    const draft2 = { id: 'PUBLISHED-2', date: '2026-09-17', staffId: 'BU-1', customerGroupId: group.id, ruleId: 'R04', remark: '待撤销记录' };
    await request(app).post(base + '/records').send({ ...draft2, action: 'publish', reason: '发布待撤' }).expect(200);
    await request(app).post(base + '/records/PUBLISHED-2/revoke').set('x-test-role', 'user').send({ pin: '123456', reason: '越权撤销' }).expect(403);
    await request(app).post(base + '/records/PUBLISHED-2/revoke').send({ pin: '0000', reason: '旧口令撤销' }).expect(403);
    await request(app).post(base + '/records/PUBLISHED-2/revoke').send({ pin: '123456' }).expect(400);
    const revokedRes = (await request(app).post(base + '/records/PUBLISHED-2/revoke').send({ pin: '123456', reason: '合规复核撤销' }).expect(200)).body;
    assert.equal(revokedRes.status, 'revoked');
    assert.equal(revokedRes.revokeReason, '合规复核撤销');
    const revokeAudit = (await request(app).get(base + '/audit').expect(200)).body;
    assert.ok(revokeAudit.rows.some(row => row.action === '撤销已发布违规' && row.reason === '合规复核撤销'));
    assert.equal(JSON.stringify(revokeAudit).includes('123456'), false);
    const otherSecurity = (await request(app).get(base + '/security').set('x-test-tenant', 'other-force-edit-test').expect(200)).body;
    assert.equal(otherSecurity.hasCustomPin, false);
});

test('draft deletion enforces ownership and status, and revocation supports proof attachments with inline preview', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        if (req.headers['x-test-role'] === 'user') req.user = { username: 'reporter', role: 'user' };
        else if (req.headers['x-test-role'] === 'other-user') req.user = { username: 'other', role: 'user' };
        else req.user = { username: 'admin', role: 'admin' };
        runWithTenant('delete-test', next);
    });
    app.use('/api/department-reward-penalty', router);
    const base = '/api/department-reward-penalty';

    const group = (await request(app).post(base + '/config/customerGroups').send({ value: '测试群' }).expect(200)).body;
    await request(app).post(base + '/personnel').send({ id: 'PERSON-1', name: '责任人', roles: ['MTD'], customerGroupIds: [group.id] }).expect(200);

    const draft = { id: 'DRAFT-DEL-1', date: '2026-09-18', staffId: 'PERSON-1', customerGroupId: group.id, ruleId: 'R04', remark: '用户草稿' };
    await request(app).post(base + '/records').set('x-test-role', 'user').send(draft).expect(200);

    // Other user cannot delete reporter's draft
    await request(app).delete(base + '/records/' + draft.id).set('x-test-role', 'other-user').expect(403);

    // Creator can delete their own draft
    const delRes = (await request(app).delete(base + '/records/' + draft.id).set('x-test-role', 'user').expect(200)).body;
    assert.equal(delRes.success, true);
    let state = (await request(app).get(base).expect(200)).body;
    assert.equal(state.records.find(r => r.id === draft.id), undefined);

    // Draft published cannot be deleted
    const draft2 = { id: 'PUBLISHED-DEL-2', date: '2026-09-18', staffId: 'PERSON-1', customerGroupId: group.id, ruleId: 'R04', remark: '已发布记录' };
    await request(app).post(base + '/records').send({ ...draft2, action: 'publish', reason: '发布' }).expect(200);
    const failDel = await request(app).delete(base + '/records/' + draft2.id).expect(400);
    assert.match(failDel.body.error, /只能删除待发布草稿/);

    // Upload an evidence image
    const uploaded = await request(app).post(base + '/evidence')
        .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), { filename: 'revoke-proof.png', contentType: 'image/png' })
        .expect(200);
    assert.match(uploaded.body.path, /\.png$/);

    // Test inline Content-Disposition for image
    const imgRes = await request(app).get(uploaded.body.path).expect(200);
    assert.equal(imgRes.headers['content-type'], 'image/png');
    assert.match(imgRes.headers['content-disposition'], /^inline;/);

    // Revoke with revokeAttachment
    const revokeRes = (await request(app).post(base + '/records/' + draft2.id + '/revoke').send({
        pin: '0000',
        reason: '撤销事实成立并附凭证',
        revokeAttachment: uploaded.body.path
    }).expect(200)).body;
    assert.equal(revokeRes.status, 'revoked');
    assert.equal(revokeRes.revokeReason, '撤销事实成立并附凭证');
    assert.equal(revokeRes.revokeAttachment, uploaded.body.path);

    state = (await request(app).get(base).expect(200)).body;
    const revokedInState = state.records.find(r => r.id === draft2.id);
    assert.equal(revokedInState.revokeAttachment, uploaded.body.path);

    // Test multi-file attachments and deletion
    const uploaded2 = await request(app).post(base + '/evidence')
        .attach('file', Buffer.from('%PDF-1.4 test pdf content'), { filename: 'evidence-doc.pdf', contentType: 'application/pdf' })
        .expect(200);
    assert.match(uploaded2.body.path, /\.pdf$/);

    const draft3 = {
        id: 'RECORD-MULTI-ATTACH',
        date: '2026-09-18',
        staffId: 'PERSON-1',
        customerGroupId: group.id,
        ruleId: 'R04',
        remark: '多附件证据测试',
        attachments: [uploaded.body.path, uploaded2.body.path]
    };
    await request(app).post(base + '/records').send(draft3).expect(200);
    state = (await request(app).get(base).expect(200)).body;
    const multiRecord = state.records.find(r => r.id === draft3.id);
    assert.equal(multiRecord.attachments.length, 2);
    assert.equal(multiRecord.attachment, uploaded.body.path);

    // Test deleting attachments upon edit
    await request(app).post(base + '/records').send({ ...draft3, attachments: [] }).expect(200);
    state = (await request(app).get(base).expect(200)).body;
    const clearedRecord = state.records.find(r => r.id === draft3.id);
    assert.equal(clearedRecord.attachment, '');
    assert.equal(clearedRecord.attachments.length, 0);

    // Test archive attachments (zip, 7z)
    const uploadedZip = await request(app).post(base + '/evidence')
        .attach('file', Buffer.from('PK\x03\x04fake zip content'), { filename: 'archive.zip', contentType: 'application/zip' })
        .expect(200);
    assert.match(uploadedZip.body.path, /\.zip$/);
    const zipRes = await request(app).get(uploadedZip.body.path).expect(200);
    assert.equal(zipRes.headers['content-type'], 'application/zip');
    assert.match(zipRes.headers['content-disposition'], /^attachment; filename="evidence\.zip"$/);

    const uploaded7z = await request(app).post(base + '/evidence')
        .attach('file', Buffer.from('7z\xbc\xaf\x27\x1c'), { filename: 'backup.7z', contentType: 'application/octet-stream' })
        .expect(200);
    assert.match(uploaded7z.body.path, /\.7z$/);

    // Test email attachments (eml, msg)
    const uploadedEml = await request(app).post(base + '/evidence')
        .attach('file', Buffer.from('From: hr@example.com\nSubject: notice'), { filename: 'notice.eml', contentType: 'message/rfc822' })
        .expect(200);
    assert.match(uploadedEml.body.path, /\.eml$/);
    const emlRes = await request(app).get(uploadedEml.body.path).expect(200);
    assert.equal(emlRes.headers['content-type'], 'message/rfc822');
    assert.match(emlRes.headers['content-disposition'], /^attachment; filename="evidence\.eml"$/);

    const uploadedMsg = await request(app).post(base + '/evidence')
        .attach('file', Buffer.from('fake outlook msg content'), { filename: 'notice.msg', contentType: 'application/octet-stream' })
        .expect(200);
    assert.match(uploadedMsg.body.path, /\.msg$/);
    const msgRes = await request(app).get(uploadedMsg.body.path).expect(200);
    assert.equal(msgRes.headers['content-type'], 'application/vnd.ms-outlook');
    assert.match(msgRes.headers['content-disposition'], /^attachment; filename="evidence\.msg"$/);

    // Test saving a record with archive and email attachments
    const draftArchiveEmail = {
        id: 'RECORD-ARCHIVE-EMAIL',
        date: '2026-09-19',
        staffId: 'PERSON-1',
        customerGroupId: group.id,
        ruleId: 'R04',
        remark: '压缩包与邮件凭证测试',
        attachments: [uploadedZip.body.path, uploadedEml.body.path, uploadedMsg.body.path]
    };
    await request(app).post(base + '/records').send(draftArchiveEmail).expect(200);
    state = (await request(app).get(base).expect(200)).body;
    const recArchiveEmail = state.records.find(r => r.id === draftArchiveEmail.id);
    assert.equal(recArchiveEmail.attachments.length, 3);
    assert.equal(recArchiveEmail.attachments[0], uploadedZip.body.path);
    assert.equal(recArchiveEmail.attachments[1], uploadedEml.body.path);
    assert.equal(recArchiveEmail.attachments[2], uploadedMsg.body.path);
});

test('batch edit personnel supports customer groups, BUs, and roles', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { username: 'admin', role: 'admin' }; next(); });
    app.use('/api/department-reward-penalty', router);
    const base = '/api/department-reward-penalty';

    // Create a few customer groups, BUs and roles
    const g1 = (await request(app).post(base + '/config/customerGroups').send({ value: '客户群一' }).expect(200)).body;
    const g2 = (await request(app).post(base + '/config/customerGroups').send({ value: '客户群二' }).expect(200)).body;
    const bu1 = (await request(app).post(base + '/config/businessUnits').send({ value: 'BU-A' }).expect(200)).body;
    const bu2 = (await request(app).post(base + '/config/businessUnits').send({ value: 'BU-B' }).expect(200)).body;

    // Create 2 persons
    await request(app).post(base + '/personnel').send({
        id: 'BP-1',
        name: '张三',
        customerGroupIds: [g1.id],
        businessUnitIds: [bu1.id],
        roles: ['MTD']
    }).expect(200);

    await request(app).post(base + '/personnel').send({
        id: 'BP-2',
        name: '李四',
        customerGroupIds: [g1.id],
        businessUnitIds: [bu1.id],
        roles: ['MTD']
    }).expect(200);

    // Batch add BU-B and customer group 2, replace role with TL
    const batchRes = (await request(app).post(base + '/personnel/batch').send({
        ids: ['BP-1', 'BP-2'],
        groups: { mode: 'add', values: [g2.id] },
        bus: { mode: 'add', values: [bu2.id] },
        roles: { mode: 'replace', values: ['TL'] }
    }).expect(200)).body;
    assert.equal(batchRes.updatedCount, 2);

    const state = (await request(app).get(base).expect(200)).body;
    const p1 = state.personnel.find(p => p.id === 'BP-1');
    const p2 = state.personnel.find(p => p.id === 'BP-2');

    assert.ok(p1.customerGroupIds.includes(g1.id) && p1.customerGroupIds.includes(g2.id));
    assert.ok(p1.businessUnitIds.includes(bu1.id) && p1.businessUnitIds.includes(bu2.id));
    assert.deepEqual(p1.roles, ['TL']);

    assert.ok(p2.customerGroupIds.includes(g1.id) && p2.customerGroupIds.includes(g2.id));
    assert.ok(p2.businessUnitIds.includes(bu1.id) && p2.businessUnitIds.includes(bu2.id));
    assert.deepEqual(p2.roles, ['TL']);
});

test('record archiving and unarchiving keeps state and audit log', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { username: 'admin', role: 'admin' }; next(); });
    app.use('/api/department-reward-penalty', router);
    const base = '/api/department-reward-penalty';

    const group = (await request(app).post(base + '/config/customerGroups').send({ value: '归档测试群' }).expect(200)).body;
    await request(app).post(base + '/personnel').send({ id: 'P-ARCH', name: '王五', customerGroupIds: [group.id], roles: ['MTD'] }).expect(200);

    const rec = { id: 'REC-ARCH-1', date: '2026-09-19', staffId: 'P-ARCH', customerGroupId: group.id, ruleId: 'R04', action: 'publish', reason: '正式发布' };
    await request(app).post(base + '/records').send(rec).expect(200);
    await request(app).post(base + '/records').send({ ...rec, id: 'REC-DRAFT-NO-ARCHIVE', action: 'save' }).expect(200);
    await request(app).post(base + '/records/REC-DRAFT-NO-ARCHIVE/archive').expect(409);

    let state = (await request(app).get(base).expect(200)).body;
    let r = state.records.find(item => item.id === rec.id);
    assert.equal(r.status, 'published');
    assert.equal(Boolean(r.archived), false);
    // Archive the record
    await request(app).post(base + `/records/${rec.id}/archive`).send({ reason: '历史记录归档封存' }).expect(200);
    state = (await request(app).get(base).expect(200)).body;
    r = state.records.find(item => item.id === rec.id);
    assert.equal(r.status, 'archived');
    assert.equal(r.archived, true);
    assert.equal(r.previousStatus, 'published');

    // Restore the record
    await request(app).post(base + `/records/${rec.id}/unarchive`).expect(200);
    state = (await request(app).get(base).expect(200)).body;
    r = state.records.find(item => item.id === rec.id);
    assert.equal(r.status, 'published');
    assert.equal(Boolean(r.archived), false);
    const revoked = (await request(app).post(base + `/records/${rec.id}/revoke`).send({ pin: '0000', reason: '复核撤销' }).expect(200)).body;
    assert.equal(revoked.status, 'revoked');
    await request(app).post(base + `/records/${rec.id}/archive`).expect(200);
    const restoredRevoked = (await request(app).post(base + `/records/${rec.id}/unarchive`).expect(200)).body;
    assert.equal(restoredRevoked.status, 'revoked');
});

test('data backup and restore: export zip/json, inspect diff, merge restore, and protected replace restore', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = req.headers['x-test-role'] === 'user' ? { username: 'reporter', role: 'user' } : { username: 'admin', role: 'admin' };
        next();
    });
    app.use('/api/department-reward-penalty', router);
    const base = '/api/department-reward-penalty';

    // 1. Regular user is forbidden
    await request(app).get(base + '/backup/export').set('x-test-role', 'user').expect(403);
    await request(app).get(base + '/backup/export-json').set('x-test-role', 'user').expect(403);
    await request(app).post(base + '/backup/inspect').set('x-test-role', 'user').expect(403);
    await request(app).post(base + '/backup/restore').set('x-test-role', 'user').expect(403);

    // 2. Export ZIP and JSON as admin
    const zipRes = await request(app)
        .get(base + '/backup/export')
        .buffer(true)
        .parse((res, callback) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);
    assert.equal(zipRes.headers['content-type'], 'application/zip');
    assert.ok(zipRes.body.length > 0);

    const jsonRes = await request(app).get(base + '/backup/export-json').expect(200);
    assert.equal(jsonRes.headers['content-type'], 'application/json; charset=utf-8');
    const exportedJson = JSON.parse(jsonRes.text);
    assert.ok(exportedJson.manifest);
    assert.equal(exportedJson.manifest.type, 'department-reward-penalty-backup');
    assert.ok(Array.isArray(exportedJson.data.rules));

    // 3. Inspect the exported package
    const inspectRes = await request(app)
        .post(base + '/backup/inspect')
        .attach('file', zipRes.body, 'backup.zip')
        .expect(200);
    assert.equal(inspectRes.body.valid, true);
    assert.ok(inspectRes.body.diff.rules);
    assert.ok(inspectRes.body.stats.rules > 0);

    // 4. Test incremental merge restore with new person
    const customBackup = {
        manifest: { type: 'department-reward-penalty-backup', version: 1, exportedAt: new Date().toISOString() },
        data: {
            personnel: [{ id: 'P-MERGE-1', name: '合并新增人员', roles: ['MTD'], role: 'MTD', customerGroupIds: ['G-MERGE-1'], businessUnitIds: [], archived: false }],
            rules: [], records: [], roles: [], deductions: [], deductionCategories: [],
            customerGroups: [{ id: 'G-MERGE-1', value: '合并客户群', archived: false }], businessUnits: []
        }
    };
    const oldEvidence = await request(app)
        .post(base + '/evidence')
        .attach('file', Buffer.from('old evidence'), { filename: 'old.txt', contentType: 'text/plain' })
        .expect(200);
    await request(app)
        .post(base + '/backup/restore')
        .attach('file', Buffer.from(JSON.stringify({ data: { personnel: [{ id: 'duplicate' }, { id: 'duplicate' }] } })), 'invalid.json')
        .field('mode', 'merge')
        .expect(400);
    await request(app)
        .post(base + '/backup/inspect')
        .attach('file', Buffer.from(JSON.stringify({ data: {} })), 'empty.json')
        .expect(400);
    await request(app)
        .post(base + '/backup/restore')
        .attach('file', Buffer.from(JSON.stringify({ data: {} })), 'empty.json')
        .field('mode', 'replace')
        .field('pin', '0000')
        .expect(400);
    await request(app)
        .post(base + '/backup/restore')
        .attach('file', Buffer.from(JSON.stringify({ data: Object.fromEntries(Object.keys(customBackup.data).map(kind => [kind, []])) })), 'all-empty.json')
        .field('mode', 'replace')
        .field('pin', '0000')
        .expect(400);
    await request(app)
        .post(base + '/backup/inspect')
        .attach('file', Buffer.from(JSON.stringify({ data: { personnel: null } })), 'null.json')
        .expect(400);
    await request(app)
        .post(base + '/backup/restore')
        .attach('file', Buffer.from(JSON.stringify({ data: { ...customBackup.data, personnel: [{ ...customBackup.data.personnel[0], customerGroupIds: ['missing-group'] }] } })), 'broken-reference.json')
        .field('mode', 'merge')
        .expect(400);
    const rollbackZip = new JSZip();
    rollbackZip.file('data.json', JSON.stringify(customBackup.data));
    rollbackZip.file(`evidence/${oldEvidence.body.path.split('/').pop()}`, Buffer.from('replacement evidence'));
    const rollbackBuffer = await rollbackZip.generateAsync({ type: 'nodebuffer' });
    await db.run("CREATE TRIGGER reward_penalty_restore_failure BEFORE INSERT ON department_reward_penalty_audit WHEN NEW.action = '增量恢复数据包' BEGIN SELECT RAISE(ABORT, 'restore test failure'); END");
    try {
        await request(app).post(base + '/backup/restore').attach('file', rollbackBuffer, 'rollback.zip').field('mode', 'merge').expect(500);
    } finally {
        await db.run('DROP TRIGGER reward_penalty_restore_failure');
    }
    const originalEvidence = await request(app).get(oldEvidence.body.path).expect(200);
    assert.equal(originalEvidence.text, 'old evidence');
    const mergeRes = await request(app)
        .post(base + '/backup/restore')
        .attach('file', Buffer.from(JSON.stringify(customBackup)), 'custom.json')
        .field('mode', 'merge')
        .expect(200);
    assert.equal(mergeRes.body.success, true);
    assert.equal(mergeRes.body.mode, 'merge');
    assert.equal(mergeRes.body.counts.personnel, 1);

    let state = (await request(app).get(base).expect(200)).body;
    assert.ok(state.personnel.some(p => p.id === 'P-MERGE-1' && p.name === '合并新增人员'));

    // 5. Test replace restore: verify PIN protection
    await request(app)
        .post(base + '/backup/restore')
        .attach('file', Buffer.from(JSON.stringify(customBackup)), 'custom.json')
        .field('mode', 'replace')
        .field('pin', 'wrong-pin')
        .expect(403);

    // Correct PIN replaces data
    const replaceRes = await request(app)
        .post(base + '/backup/restore')
        .attach('file', Buffer.from(JSON.stringify(customBackup)), 'custom.json')
        .field('mode', 'replace')
        .field('pin', '0000')
        .expect(200);
    assert.equal(replaceRes.body.success, true);
    assert.equal(replaceRes.body.mode, 'replace');

    state = (await request(app).get(base).expect(200)).body;
    assert.equal(state.personnel.length, 1);
    assert.equal(state.personnel[0].id, 'P-MERGE-1');
    await request(app).get(oldEvidence.body.path).expect(404);

    // 6. Restore original ZIP backup to return system to original state
    await request(app)
        .post(base + '/backup/restore')
        .attach('file', zipRes.body, 'backup.zip')
        .field('mode', 'replace')
        .field('pin', '0000')
        .expect(200);
});
