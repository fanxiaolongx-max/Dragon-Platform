const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { profile, hintsOf, codeMappingHintForRows } = require('../backend/models/digital-human/table-catalog');

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
