(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.EzscanWarehouseDomain = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const inbound = ['其他入库单', '采购入库单', '生产入库单', '退货入库单', '盘盈入库单', '采购收货单'];
    const outbound = ['其他出库单', '领料出库单', '销售发货单'];
    const orders = ['采购订单', '销售订单'];
    const documentTypes = [...inbound, ...outbound, ...orders, '库存调拨单', '形态转换单', '盘点单'];
    const arrays = ['products', 'warehouses', 'partners', 'opening', 'docs', 'scans', 'receivables', 'payables', 'workflows', 'roles', 'logs'];
    const sampleTag = 'ezscan-sample-v1';
    const roundMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
    const amount = doc => roundMoney(doc.lines.reduce((sum, line) => sum + Number(line.qty || 0) * Number(line.price || 0), 0));
    const isCustomerDocument = type => type.startsWith('销售') || type === '退货入库单';
    const partnerKind = type => isCustomerDocument(type) ? '客户' : type.startsWith('采购') ? '供应商' : null;
    const emptyState = () => ({ schema: 3, revision: 0, ...Object.fromEntries(arrays.map(key => [key, []])), ui: { tabs: ['首页'], active: '首页' }, settings: { compact: false } });
    function executionError(data, doc) {
        if (!doc.sourceId) return '';
        const source = data.docs.find(row => row.id === doc.sourceId);
        if (!source) return '来源订单不存在';
        const ordered = new Map();
        const executed = new Map();
        source.lines.forEach(line => ordered.set(line.product, (ordered.get(line.product) || 0) + Number(line.qty)));
        doc.lines.forEach(line => executed.set(line.product, (executed.get(line.product) || 0) + Number(line.qty)));
        if ([...executed].some(([id, qty]) => !ordered.has(id) || qty > ordered.get(id) + 1e-8)) return '执行单货品或数量超出来源订单范围';
        return '';
    }
    function documentError(data, doc) {
        const warehouse = data.warehouses.find(row => row.id === doc.warehouse);
        if (!warehouse || warehouse.enabled !== '启用') return '请选择启用的仓库';
        if (!doc.operator?.trim()) return '请填写操作人';
        const kind = partnerKind(doc.type);
        const partner = data.partners.find(row => row.id === doc.partner);
        if (kind && !partner?.type.includes(kind)) return '请选择有效的' + kind;
        if (!Number.isFinite(amount(doc))) return '单据金额超出范围';
        const serials = new Set();
        for (const line of doc.lines) {
            if (line.sn?.length && (line.sn.length !== Number(line.qty) || !Number.isInteger(Number(line.qty)))) return '序列号数量必须与货品数量一致，请重新生成';
            for (const sn of line.sn || []) {
                if (!sn.trim() || serials.has(sn)) return '单据内的序列号不能为空或重复';
                serials.add(sn);
            }
        }
        if (doc.sourceId) {
            const source = data.docs.find(row => row.id === doc.sourceId);
            const expected = doc.type === '采购收货单' ? '采购订单' : doc.type === '销售发货单' ? '销售订单' : null;
            if (!expected || !source || source.type !== expected || source.status !== '已审核') return '来源订单不存在、类型不匹配或尚未审核';
            if (data.docs.some(row => row.id !== doc.id && row.sourceId === doc.sourceId)) return '该订单已经生成执行单';
            if (doc.partner !== source.partner) return '执行单往来单位必须与来源订单一致';
            const error = executionError(data, doc);
            if (error) return error;
        }
        return '';
    }
    // Historical records may use a now-disabled warehouse. Check enabled state
    // only when submitting/approving a document, not while reading old records.
    function businessError(data) {
        const children = new Set();
        for (const doc of data.docs) {
            if (doc.sourceId) {
                if (children.has(doc.sourceId)) return '同一订单只能存在一张执行单';
                children.add(doc.sourceId);
                const source = data.docs.find(row => row.id === doc.sourceId);
                const expected = doc.type === '采购收货单' ? '采购订单' : doc.type === '销售发货单' ? '销售订单' : null;
                if (!source || source.id === doc.id || source.status !== '已审核' || source.type !== expected || doc.partner !== source.partner) return '执行单与来源订单关联不一致';
            }
            if (doc.status === '草稿') continue;
            const error = executionError(data, doc);
            if (error) return error;
            const kind = partnerKind(doc.type);
            if (kind && !data.partners.find(row => row.id === doc.partner)?.type.includes(kind)) return '采购/销售单据的往来单位类型不匹配';
            if (!doc.operator?.trim()) return '提交或审核单据缺少操作人';
            const serials = doc.lines.flatMap(line => line.sn || []);
            if (new Set(serials).size !== serials.length || serials.some(sn => !sn.trim()) || doc.lines.some(line => line.sn?.length && line.sn.length !== line.qty)) return '单据序列号数量或唯一性不正确';
            if (doc.type === '盘点单' && doc.status === '已审核') {
                const effects = doc.countEffects || [];
                if (effects.length !== doc.lines.length || new Set(effects.map(effect => effect.product)).size !== effects.length || effects.some(effect => effect.warehouse !== doc.warehouse || !doc.lines.some(line => line.product === effect.product && line.actual - effect.qty >= -1e-8))) return '盘点差额与货品、仓库或审核时账面库存不一致';
            }
        }
        for (const key of ['receivables', 'payables']) {
            const linked = new Set();
            for (const bill of data[key]) {
                const kind = key === 'receivables' ? '客户' : '供应商';
                if (!data.partners.find(row => row.id === bill.partner)?.type.includes(kind)) return '账单往来单位类型不匹配';
                if ([bill.amount, bill.paid, ...bill.payments.map(payment => payment.amount)].some(value => Math.abs(roundMoney(value) - value) > 1e-8)) return '账款及收付款金额最多保留两位小数';
                const paymentIds = bill.payments.map(payment => payment.id);
                if (paymentIds.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) || new Set(paymentIds).size !== paymentIds.length) return '收付款记录编号缺失或重复';
                const sum = roundMoney(bill.payments.reduce((total, payment) => total + payment.amount, 0));
                if (Math.abs(sum - bill.paid) > 0.000001) return '账单已核销金额与收付款记录不一致';
                if (!bill.docId) continue;
                const doc = data.docs.find(row => row.id === bill.docId);
                const types = key === 'receivables' ? ['销售发货单'] : ['采购收货单', '采购入库单'];
                if (linked.has(bill.docId) || !doc || doc.status !== '已审核' || !types.includes(doc.type) || doc.partner !== bill.partner || Math.abs(amount(doc) - bill.amount) > 0.000001) return '自动账单与已审核源单的金额、单位或关联不一致';
                linked.add(bill.docId);
            }
        }
        return '';
    }
    function appendSamples(data, date = new Date()) {
        if (arrays.some(key => data[key].some(row => row.sampleTag === sampleTag))) return { data, added: false };
        const next = JSON.parse(JSON.stringify(data));
        const prefix = 'TEST-' + date.getTime().toString(36).toUpperCase();
        const day = offset => new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate() - offset)).toISOString().slice(0, 10);
        const tag = row => ({ ...row, sampleTag });
        const wh = [0, 1, 2].map(i => tag({ id: prefix + '-W' + i, code: prefix + '-W' + i, name: '[测试] ' + ['原料仓', '成品仓', '停用仓'][i], zone: '测试区', location: 'T-' + i, manager: '测试仓管员', enabled: i === 2 ? '停用' : '启用', remark: '测试数据，可在数据管理中清理' }));
        const products = [['原料A', '袋', '原料', 12.5, 10], ['成品B', '箱', '饮品', 36, 20], ['包装C', '包', '包装', 5.8, 5], ['低库存D', '件', '其他', 8, 50], ['零库存E', '瓶', '食品', 18, 10], ['转换成品F', '件', '其他', 20, 5]]
            .map((row, i) => tag({ id: prefix + '-P' + i, code: prefix + '-P' + i, name: '[测试] ' + row[0], spec: '测试规格', unit: row[1], category: row[2], price: row[3], min: row[4], remark: '测试数据' }));
        const partners = ['供应商', '客户', '供应商/客户'].map((type, i) => tag({ id: prefix + '-B' + i, code: prefix + '-B' + i, name: '[测试] ' + type, type, contact: '测试联系人', phone: '', address: '测试地址', remark: '虚构测试单位' }));
        next.warehouses.push(...wh); next.products.push(...products); next.partners.push(...partners);
        for (let i = 0; i < 2; i++) for (let j = 0; j < products.length; j++) next.opening.push(tag({ product: products[j].id, warehouse: wh[i].id, qty: j === 4 ? 0 : j === 3 ? 2 : 200 }));
        const created = date.toISOString();
        documentTypes.forEach((type, index) => {
            ['草稿', '已提交', '已审核'].forEach((status, i) => {
                const id = prefix + '-D' + index + '-' + i;
                const lines = [0, 1].map((p, n) => ({ id: id + '-L' + n, product: products[p].id, qty: 3 + n, price: products[p].price, actual: 210 + n, targetProduct: products[5].id, targetQty: 2 + n, sn: [] }));
                const doc = tag({ id, type, no: prefix + '-' + String(index + 1).padStart(2, '0') + '-' + i, date: day(i * 15), warehouse: wh[0].id, target: wh[1].id, partner: partners[isCustomerDocument(type) ? 1 : 0].id, operator: '测试操作员', status, remark: '[测试] ' + status + '业务流程', lines, created, updated: created,
                    countEffects: type === '盘点单' && status === '已审核' ? lines.map(line => ({ product: line.product, warehouse: wh[0].id, qty: 1 })) : null });
                next.docs.push(doc);
                if (status === '已审核' && ['采购收货单', '采购入库单', '销售发货单'].includes(type)) {
                    const key = type === '销售发货单' ? 'receivables' : 'payables';
                    next[key].push(tag({ id: id + '-BILL', docId: id, code: prefix + '-BILL-' + index, partner: doc.partner, source: doc.no, date: doc.date, due: day(-7), amount: amount(doc), paid: 0, payments: [], remark: '[测试] 自动账单' }));
                }
            });
        });
        for (const [i, status] of ['待同步', '已同步', '异常'].entries()) next.scans.push(tag({ id: prefix + '-SCAN' + i, code: products[i].id, warehouse: wh[0].id, qty: i + 1, device: '测试PDA', operator: '测试操作员', time: day(0) + 'T09:00', status, remark: '[测试] 手工采集记录，不连接真实设备' }));
        for (const key of ['receivables', 'payables']) for (const [i, paid] of [0, 30, 100].entries()) next[key].push(tag({ id: prefix + '-' + key + i, code: prefix + '-' + (key === 'receivables' ? 'AR' : 'AP') + i, partner: partners[key === 'receivables' ? 1 : 0].id, source: '', date: day(10), due: day(i === 0 ? 1 : -7), amount: 100, paid, payments: paid ? [{ id: prefix + '-PAY-' + key + i, amount: paid, time: created, remark: '测试收付款' }] : [], remark: '[测试] ' + ['未核销/逾期', '部分核销', '已结清'][i] }));
        next.workflows.push(tag({ id: prefix + '-WF', code: prefix + '-WF', name: '[测试] 入库审批模板', scope: '入库', nodes: '仓管员 > 仓库主管', owner: '测试主管', enabled: '启用', remark: '仅作为流程模板展示' }));
        next.roles.push(tag({ id: prefix + '-ROLE', code: prefix + '-ROLE', name: '[测试] 仓库岗位模板', users: '测试成员', menus: '总货品库存、其他入库单、其他出库单、盘点单', actions: '查看/新增/编辑', enabled: '启用', remark: '实际权限由平台账号决定' }));
        // Freeze count actuals to match the approved sample adjustments.
        const quantities = new Map(next.opening.map(row => [row.product + '|' + row.warehouse, row.qty]));
        for (const doc of next.docs.filter(row => row.sampleTag === sampleTag && row.status === '已审核' && row.type !== '盘点单')) for (const line of doc.lines) {
            const add = (p, w, q) => quantities.set(p + '|' + w, (quantities.get(p + '|' + w) || 0) + q);
            if (inbound.includes(doc.type)) add(line.product, doc.warehouse, line.qty);
            else if (outbound.includes(doc.type)) add(line.product, doc.warehouse, -line.qty);
            else if (doc.type === '库存调拨单') { add(line.product, doc.warehouse, -line.qty); add(line.product, doc.target, line.qty); }
            else if (doc.type === '形态转换单') { add(line.product, doc.warehouse, -line.qty); add(line.targetProduct, doc.warehouse, line.targetQty); }
        }
        for (const doc of next.docs.filter(row => row.sampleTag === sampleTag && row.type === '盘点单' && row.status === '已审核')) for (const line of doc.lines) line.actual = quantities.get(line.product + '|' + doc.warehouse) + 1;
        return { data: next, added: true };
    }
    function removeSamples(data) {
        const next = JSON.parse(JSON.stringify(data));
        const ids = new Set(arrays.flatMap(key => next[key].filter(row => row.sampleTag === sampleTag).map(row => row.id).filter(Boolean)));
        for (const key of arrays) for (const row of next[key].filter(item => item.sampleTag !== sampleTag)) {
            const refs = [row.product, row.warehouse, row.target, row.partner, row.code, row.sourceId, row.docId, ...(row.lines || []).flatMap(line => [line.product, line.targetProduct])];
            if (refs.some(id => ids.has(id))) throw new Error('正式记录已引用测试档案，请先移除相关业务引用后再清理测试数据');
        }
        for (const key of arrays) next[key] = next[key].filter(row => row.sampleTag !== sampleTag);
        next.ui = { tabs: ['首页'], active: '首页' };
        return next;
    }
    return { amount, roundMoney, documentError, businessError, appendSamples, removeSamples, sampleTag, emptyState };
}));
