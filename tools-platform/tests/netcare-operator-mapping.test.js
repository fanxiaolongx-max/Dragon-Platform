const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { profile, hintsOf, codeMappingHintForRows, resolveCodeMappingsForRows } = require('../backend/models/digital-human/table-catalog');

test('主线版 NetCare 运营商/地代编码自动识别与按存在性提示映射表', () => {
    const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '../backend/models/digital-human/netcare-table-seed.json'), 'utf8'));
    assert.match(seed.tables.cs_nc_comm_customer_d_list.nameCn, /运营商/);
    assert.match(seed.tables.common_data_rep.nameCn, /代表处/);

    const fields = profile(
        [
            { name: 't1_operator_code', dataType: 'varchar' },
            { name: 'customer_number', dataType: 'varchar' },
            { name: 'repoffice_code', dataType: 'varchar' },
        ],
        [{ t1_operator_code: '028262', customer_number: '10001', repoffice_code: '026921' }],
    );
    assert.equal(fields.find(f => f.name === 't1_operator_code').role, 'operator');
    assert.equal(fields.find(f => f.name === 'customer_number').role, 'customer');

    const withTables = hintsOf('op_ioc_digital_cert_2026_d_dwd', fields, null, {
        operator: ['cs_nc_comm_customer_d_list', 'cs_nc_comm_customer_d_list_dim'],
        rep: ['common_data_rep'],
        country: [],
    });
    assert.ok(withTables.some(h => h.includes('cs_nc_comm_customer_d_list') && h.includes('t1_operator_code')));
    assert.ok(withTables.some(h => h.includes('common_data_rep') && h.includes('repoffice_code')));

    const withoutTables = hintsOf('op_ioc_digital_cert_2026_d_dwd', fields, null, {
        operator: [],
        rep: [],
        country: [],
    });
    assert.equal(withoutTables.some(h => h.includes('cs_nc_comm_customer_d_list')), false);

    const rawRows = [{ t1_operator_code: '028262', total_tasks: 543 }];
    assert.match(codeMappingHintForRows(rawRows, { operator: ['cs_nc_comm_customer_d_list'], rep: [] }), /cs_nc_comm_customer_d_list/);
    assert.equal(codeMappingHintForRows([{ t1_operator_code: '028262', operator_name: '移动系统部' }], { operator: ['cs_nc_comm_customer_d_list'], rep: [] }), '');
    assert.equal(codeMappingHintForRows(rawRows, { operator: [], rep: [] }), '');
});

test('主线版 NetCare 服务端实时编码解析：按真实列动态 IN 查询、不缓存过时名称、缺表静默跳过', async () => {
    const dimCols = {
        cs_nc_comm_customer_d_list: ['hq_cust_category_code', 'hq_cust_category_cn_name', 'hq_cust_category_en_name', 'cust_account_num', 'mergered_cust_name'],
        common_data_rep: ['dept_code', 'rep_name_cn', 'rep_name_en'],
    };
    let liveName = '移动系统部';
    const sqlLog = [];
    const runQuery = async (sql) => {
        sqlLog.push(sql);
        if (sql.includes('hq_cust_category_code')) {
            return [{ __code: '028262', __cn: liveName, __en: 'China Mobile Dept' }];
        }
        if (sql.includes('dept_code')) {
            return [{ __code: '026921', __cn: '埃及代表处', __en: 'Egypt Rep Office' }];
        }
        return [];
    };
    const getCols = async (t) => dimCols[t] || [];
    const mapTables = { operator: ['cs_nc_comm_customer_d_list'], rep: ['common_data_rep'], country: [] };

    const rows = [
        { t1_operator_code: 'Others', repoffice_code: '026921', cnt: 630 },
        { t1_operator_code: '028262', repoffice_code: '026921', cnt: 543 },
    ];
    const out1 = await resolveCodeMappingsForRows(rows, { scope: 'business', mapTables, getCols, runQuery });
    assert.match(out1, /028262: 移动系统部 \/ China Mobile Dept/);
    assert.match(out1, /026921: 埃及代表处 \/ Egypt Rep Office/);
    assert.doesNotMatch(out1, /Others:/);

    liveName = '中国移动系统部（更新）';
    const out2 = await resolveCodeMappingsForRows(rows, { scope: 'business', mapTables, getCols, runQuery });
    assert.match(out2, /028262: 中国移动系统部（更新） \/ China Mobile Dept/);

    const before = sqlLog.length;
    assert.equal(await resolveCodeMappingsForRows(rows, { scope: 'business', mapTables: { operator: [], rep: [], country: [] }, getCols, runQuery }), '');
    assert.equal(sqlLog.length, before);
});
