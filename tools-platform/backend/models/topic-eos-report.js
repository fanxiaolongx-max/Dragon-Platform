// Pure saved-snapshot calculations; usable in background search without opening a database.
function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function firstNumber(row, keys) {
    for (const key of keys) {
        const value = Number(row?.[key]);
        if (Number.isFinite(value)) return value;
    }
    return 0;
}

function buildEosTopic(rows, type, settings) {
    const grouped = new Map();
    const aliases = { 'NILE ON LINE (NOL)': 'Etisalat Misr' };
    for (const row of rows || []) {
        const customer = aliases[String(row?.customer_name || '').trim()] || String(row?.customer_name || '').trim() || '未分类客户';
        const productLine = String(row?.product_line_name || row?.product_line_map || '');
        const product = String(row?.product_name || '未命名产品');
        const label = type === 'product'
            ? String(row?.product_name || row?.product_code_name || row?.product_code || '未命名产品')
            : String(row?.software_version || row?.version_name || row?.product_name || '未命名版本');
        const key = [customer, productLine, type === 'product' ? String(row?.product_name || '') : product, label].join('|||');
        if (!grouped.has(key)) grouped.set(key, { quantity: 0, incorporated: 0, pending: 0 });
        const item = grouped.get(key);
        const quantity = firstNumber(row, ['incorporation_total_nes', 'annual_storage', 'capacities', 'current_inventory']);
        const normal = type === 'product'
            ? firstNumber(row, ['before_urgent_incorporated_nes_dtl', 'incorporated_nes'])
            : firstNumber(row, ['nc_urgent_incorp_complet_rate_dtl', 'incorporated_nes']);
        item.quantity += quantity;
        item.incorporated += quantity > 0 ? Math.min(quantity, normal + firstNumber(row, ['deactivated_nes'])) : normal;
        item.pending += firstNumber(row, ['to_be_incorporated_nes']);
    }
    const plans = settings?.eos?.plans?.[type] || {};
    const totals = [...grouped.entries()].reduce((result, [key, item]) => {
        const annualPlan = Math.min(item.pending, Math.max(0, Math.floor(number(plans[key]))));
        result.quantity += item.quantity; result.incorporated += item.incorporated; result.pending += item.pending;
        result.annualPlan += annualPlan; result.noPlan += Math.max(0, item.pending - annualPlan);
        return result;
    }, { quantity: 0, incorporated: 0, pending: 0, annualPlan: 0, noPlan: 0 });
    totals.currentRate = totals.quantity ? round2(Math.min(totals.quantity, totals.incorporated) / totals.quantity * 100) : 0;
    totals.plannedRate = totals.quantity ? round2(Math.min(totals.quantity, totals.incorporated + totals.annualPlan) / totals.quantity * 100) : 0;
    totals.targetRate = number(settings?.eos?.targets?.[type]) !== null ? round2(number(settings?.eos?.targets?.[type])) : null;
    return totals;
}

function buildEosMonthlyReport(item, month) {
    const snapshot = item.snapshot;
    const aliases = { 'NILE ON LINE (NOL)': 'Etisalat Misr' };
    const customerName = row => aliases[String(row?.customer_name || '').trim()] || String(row?.customer_name || '').trim() || '未分类客户';
    const buildSection = type => {
        const rows = type === 'product' ? snapshot.data.eosProduct : snapshot.data.eosVersion;
        const customers = [...new Set(rows.map(customerName))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
        const accounts = customers.map(customer => {
            const custRows = rows.filter(row => customerName(row) === customer);
            const topic = buildEosTopic(custRows, type, snapshot.settings);
            const subGroups = new Map();
            for (const r of custRows) {
                const product = String(r?.product_name || '未命名产品');
                const label = type === 'product'
                    ? String(r?.product_name || r?.product_code_name || r?.product_code || '未命名产品')
                    : String(r?.software_version || r?.version_name || product || '未命名版本');
                const key = [product, label].join('|||');
                if (!subGroups.has(key)) subGroups.set(key, { label, rows: [] });
                subGroups.get(key).rows.push(r);
            }
            const subItems = [...subGroups.values()].map(g => ({
                label: g.label,
                ...buildEosTopic(g.rows, type, snapshot.settings)
            }));
            const topNoPlanItems = subItems.filter(item => item.noPlan > 0)
                .sort((a, b) => b.noPlan - a.noPlan || a.label.localeCompare(b.label, 'zh-CN'))
                .slice(0, 5)
                .map(({ label, noPlan }) => ({ label, noPlan }));
            const topPlanItems = subItems.filter(item => item.annualPlan > 0)
                .sort((a, b) => b.annualPlan - a.annualPlan || a.label.localeCompare(b.label, 'zh-CN'))
                .slice(0, 5)
                .map(({ label, annualPlan }) => ({ label, annualPlan }));
            return { customer, ...topic, topNoPlanItems, topPlanItems };
        });
        const total = buildEosTopic(rows, type, snapshot.settings);
        const groups = new Map();
        for (const row of rows) {
            const customer = customerName(row);
            const product = String(row?.product_name || '未命名产品');
            const label = type === 'product' ? product : String(row?.software_version || row?.version_name || product);
            const key = [customer, String(row?.product_line_name || row?.product_line_map || ''), type === 'product' ? product : product, label].join('|||');
            if (!groups.has(key)) groups.set(key, { customer, label: type === 'product' ? product : `${product} / ${label}`, rows: [] });
            groups.get(key).rows.push(row);
        }
        const priorities = [...groups.values()].map(group => ({ customer: group.customer, label: group.label, ...buildEosTopic(group.rows, type, snapshot.settings) }))
            .filter(group => group.noPlan > 0).sort((a, b) => b.noPlan - a.noPlan || a.label.localeCompare(b.label, 'zh-CN')).slice(0, 10)
            .map(({ customer, label, noPlan }) => ({ customer, label, noPlan }));
        return { accounts, total, priorities };
    };
    return { month, snapshot: {
        id: item.id, name: item.name, capturedAt: item.capturedAt, importedAt: item.importedAt
    }, product: buildSection('product'), version: buildSection('version') };
}

module.exports={buildEosTopic,buildEosMonthlyReport};
