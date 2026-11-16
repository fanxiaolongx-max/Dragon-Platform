'use strict';
const { run, get } = require('./app-db');
const ExcelJS = require('exceljs');
const { readWorksheetRows } = require('./excel-sheet-rows');
const FIELDS = ['scenario', 'productLine', 'productCategory', 'productName', 'creator', 'createTime', 'updator', 'updateTime'];
const invalid = message => Object.assign(new Error(message), { status: 400 });

function normalizeProducts(products) {
    if (!Array.isArray(products) || !products.length || products.length > 50000) throw invalid('请提供 1–50000 条产品记录');
    const normalized = products.map((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw invalid(`第 ${index + 1} 条产品格式不正确`);
        const row = {};
        for (const field of FIELDS) {
            const value = item[field] ?? '';
            if (!['string', 'number'].includes(typeof value) || String(value).length > 10000) throw invalid(`第 ${index + 1} 条产品字段格式不正确`);
            row[field] = String(value).trim();
        }
        if (!row.productName) throw invalid(`第 ${index + 1} 条缺少产品名称`);
        return row;
    });
    if (Buffer.byteLength(JSON.stringify(normalized)) > 20 * 1024 * 1024) throw invalid('解析后的产品数据不能超过 20 MB');
    return normalized;
}

function parseDelimited(text, delimiter) {
    const rows = []; let row = [], cell = '', quoted = false;
    text = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') {
            if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
        } else if (ch === delimiter && !quoted) { row.push(cell); cell = ''; }
        else if ((ch === '\n' || ch === '\r') && !quoted) {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(cell); rows.push(row); row = []; cell = '';
        } else cell += ch;
    }
    if (quoted) throw invalid('数据文件的引号未闭合');
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(row => row.some(value => String(value).trim()));
}

function productsFromRows(rows) {
    const aliases = [
        ['ict作业场景', 'ictoperationscenario'], ['产品线', 'productline'], ['产品族', 'productcategory'],
        ['产品', 'product', '产品名称', 'productname'], ['创建人', 'creator'], ['创建时间', 'createtime'],
        ['更新人', 'updator', 'updater'], ['更新时间', 'updatetime']
    ];
    const headers = (rows.shift() || []).map(value => String(value).toLowerCase().replace(/[\s\p{P}\p{S}]/gu, ''));
    const columns = FIELDS.map((_, i) => headers.findIndex(header => aliases[i].some(alias =>
        i === 3 ? header === alias || header === '产品product' || header === 'product产品' || header.includes('产品名称') || header.includes('productname') : header.includes(alias))));
    if (columns[3] < 0) throw invalid('缺少“产品 / Product”或“产品名称 / Product Name”表头');
    return normalizeProducts(rows.map(values => Object.fromEntries(FIELDS.map((field, i) => [field, values[columns[i]] ?? '']))));
}

async function parseImport(buffer, filename) {
    if (/\.json$/i.test(filename)) {
        let data;
        try { data = JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, '')); } catch (_) { throw invalid('JSON 文件格式不正确'); }
        return normalizeProducts(Array.isArray(data) ? data : data?.products);
    }
    if (/\.xlsx$/i.test(filename)) {
        const workbook = new ExcelJS.Workbook();
        try { await workbook.xlsx.load(buffer); } catch (_) { throw invalid('无法读取 Excel 文件'); }
        const sheet = workbook.worksheets[0];
        const columnCount = sheet ? sheet.columnCount : 0;
        if (!sheet || sheet.rowCount > 50001 || columnCount > 100) throw invalid('Excel 工作表为空，或超过 50000 条记录 / 100 列');
        const rows = await readWorksheetRows(sheet, { includeEmptyRows: false, readCell: cell => cell.text ?? '', minColumns: columnCount });
        return productsFromRows(rows);
    }
    if (!/\.(csv|tsv|txt)$/i.test(filename)) throw invalid('支持 XLSX、CSV、TSV、TXT 和 JSON 文件');
    return productsFromRows(parseDelimited(buffer.toString('utf8'), /\.csv$/i.test(filename) ? ',' : '\t'));
}

async function ensureSchema() {
    await run('CREATE TABLE IF NOT EXISTS product_scope_dataset (id INTEGER PRIMARY KEY CHECK(id = 1), products_json TEXT NOT NULL, updated_at TEXT NOT NULL)');
}
async function loadProducts() {
    await ensureSchema();
    const row = await get('SELECT products_json, updated_at FROM product_scope_dataset WHERE id = 1');
    return row ? { products: JSON.parse(row.products_json), updatedAt: row.updated_at } : { products: [], updatedAt: null };
}
async function saveProducts(products) {
    const normalized = normalizeProducts(products);
    await ensureSchema();
    const updatedAt = new Date().toISOString();
    await run('INSERT OR REPLACE INTO product_scope_dataset (id, products_json, updated_at) VALUES (1, ?, ?)', [JSON.stringify(normalized), updatedAt]);
    return { products: normalized, updatedAt };
}
module.exports = { FIELDS, normalizeProducts, parseImport, loadProducts, saveProducts };
