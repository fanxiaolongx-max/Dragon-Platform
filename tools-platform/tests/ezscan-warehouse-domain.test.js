'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../frontend/js/ezscan-warehouse-domain');
const { validateState } = require('../backend/models/ezscan-warehouse-repository');
const samples = () => domain.appendSamples(domain.emptyState(), new Date('2026-10-15T10:00:00Z')).data;

test('sample data covers every document and status, warnings, receipts, payments, templates and scan states', () => {
    const data = samples();
    assert.equal(validateState(data), data);
    assert.equal(data.docs.length, 42);
    assert.equal(new Set(data.docs.map(doc => doc.type)).size, 14);
    for (const type of new Set(data.docs.map(doc => doc.type))) assert.deepEqual(data.docs.filter(doc => doc.type === type).map(doc => doc.status), ['草稿', '已提交', '已审核']);
    assert.equal(data.products.length, 6);
    assert.ok(data.warehouses.some(row => row.enabled === '停用'));
    assert.ok(data.opening.some(row => row.qty === 0));
    assert.ok(data.opening.some(row => row.qty === 2));
    for (const key of ['receivables', 'payables']) assert.deepEqual(data[key].filter(bill => !bill.docId).map(bill => bill.paid), [0, 30, 100]);
    assert.deepEqual(data.scans.map(row => row.status), ['待同步', '已同步', '异常']);
    assert.equal(domain.businessError(data), '');
});

test('samples append without replacing real data, repeated add is idempotent, cleanup preserves real data', () => {
    const original = domain.emptyState();
    original.products.push({ id: 'real', code: 'REAL', name: '真实货品', spec: '', unit: '件', category: '其他', price: 5, min: 1 });
    const untouched = JSON.stringify(original);
    const result = domain.appendSamples(original);
    assert.equal(JSON.stringify(original), untouched);
    assert.deepEqual(result.data.products[0], original.products[0]);
    assert.equal(domain.appendSamples(result.data).added, false);
    assert.deepEqual(domain.removeSamples(result.data), original);
});

test('cleanup rejects formal documents or stock that reference sample master records', () => {
    for (const kind of ['docs', 'opening', 'scans', 'payables']) {
        const data = samples();
        const real = { ...data[kind][0], id: 'real-' + kind };
        delete real.sampleTag;
        data[kind].push(real);
        assert.throws(() => domain.removeSamples(data), /正式记录已引用测试档案/);
    }
});

test('document submission rejects wrong partner type, stale serial quantities and duplicate serials', () => {
    const data = samples();
    const doc = data.docs.find(row => row.type === '采购订单' && row.status === '草稿');
    doc.partner = data.partners.find(row => row.type === '客户').id;
    assert.match(domain.documentError(data, doc), /供应商/);
    doc.partner = data.partners.find(row => row.type === '供应商').id;
    doc.lines[0].sn = ['SN1'];
    assert.match(domain.documentError(data, doc), /序列号数量/);
    doc.lines[0].sn = ['SN1', 'SN1', 'SN2'];
    assert.match(domain.documentError(data, doc), /重复/);
});

test('execution documents require an approved matching order and cannot duplicate or overexecute it', () => {
    const data = samples();
    const order = data.docs.find(row => row.type === '采购订单' && row.status === '已审核');
    const execution = data.docs.find(row => row.type === '采购收货单' && row.status === '草稿');
    execution.sourceId = order.id;
    execution.source = order.no;
    assert.equal(domain.documentError(data, execution), '');
    execution.lines[0].qty = 999;
    assert.match(domain.documentError(data, execution), /超出来源订单/);
    execution.lines[0].qty = order.lines[0].qty;
    order.status = '草稿';
    assert.match(domain.documentError(data, execution), /尚未审核/);
    assert.match(domain.businessError(data), /关联不一致/);
    order.status = '已审核';
    data.docs.push({ ...execution, id: 'duplicate-execution' });
    assert.match(domain.businessError(data), /一张执行单/);
});

test('financial validation rejects inconsistent receipts and automatic source bills', () => {
    let data = samples();
    data.receivables.find(row => row.paid > 0).paid += 1;
    assert.match(domain.businessError(data), /收付款记录不一致/);
    data = samples();
    data.payables.find(row => row.docId).amount += 10;
    assert.match(domain.businessError(data), /自动账单/);
    data = samples();
    data.payables.find(row => row.docId).partner = data.partners.find(row => row.type === '客户').id;
    assert.match(domain.businessError(data), /往来单位类型/);
});

test('money calculations use cents and historical disabled warehouses remain readable', () => {
    assert.equal(domain.amount({ lines: [{ qty: 3, price: 0.1 }] }), 0.3);
    assert.equal(domain.roundMoney(0.1 + 0.2), 0.3);
    const data = samples();
    data.warehouses[0].enabled = '停用';
    assert.equal(domain.businessError(data), '');
    assert.match(domain.documentError(data, data.docs[0]), /启用的仓库/);
    assert.equal(validateState(data), data);
});

test('count adjustments cannot refer to another warehouse or invent unrelated product effects', () => {
    const data = samples();
    const count = data.docs.find(doc => doc.type === '盘点单' && doc.status === '已审核');
    count.countEffects[0].warehouse = data.warehouses[1].id;
    assert.match(domain.businessError(data), /盘点差额/);
});

test('unsafe imported IDs and duplicate payment IDs are rejected before rendering or saving', () => {
    const data = samples();
    data.roles[0].id = '" onfocus="alert(1)';
    assert.throws(() => validateState(data), /不安全字符/);
    const paid = samples();
    const bill = paid.receivables.find(row => row.paid > 0);
    bill.payments.push({ ...bill.payments[0] });
    bill.paid *= 2;
    assert.match(domain.businessError(paid), /编号缺失或重复/);
});
