'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const express = require('express');
const ExcelJS = require('exceljs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'product-scope-test-'));
process.env.TOOLS_DATA_DIR = temp;
const db = require('../backend/models/app-db');
const { runWithTenant } = require('../backend/models/tenant-context');
const products = require('../backend/models/product-scope-repository');
const snapshots = require('../backend/models/product-scope-snapshot');
const router = require('../backend/routes/custom-tools');
const app = express();
app.use((req, res, next) => {
    req.user = { role: req.headers['x-role'] || 'admin' };
    runWithTenant(req.headers['x-tenant'] || 'default', next);
});
app.use('/api/custom-tools', router);
const endpoint = '/api/custom-tools/tool-mumxi3px/products';

test.before(async () => {
    await runWithTenant('default', async () => {
        const customToolsRepo = require('../backend/models/custom-tools-repository');
        const dist = require('../backend/models/tool-distribution');
        await customToolsRepo.createTool({ slug: 'tool-mumxi3px', name: 'Products', htmlContent: '<html><body>p</body></html>' });
        await dist.setSharedAccess('tool-mumxi3px', true);
    });
});
test.after(async () => { await db.closeDatabase(); fs.rmSync(temp, { recursive: true, force: true }); });

test('imports bilingual Excel headers, quoted CSV and exported JSON without losing fields', async () => {
    const csv = '"产品\nProduct","ICT作业场景\nICT Operation Scenario",Product Line\r\n"A, B","line one\nline two",Core\r\n';
    const rows = await products.parseImport(Buffer.from(csv), 'products.csv');
    assert.equal(rows[0].productName, 'A, B');
    assert.equal(rows[0].scenario, 'line one\nline two');
    assert.equal(rows[0].productLine, 'Core');
    assert.deepEqual(await products.parseImport(Buffer.from(JSON.stringify({ version: 1, products: rows })), 'products.json'), rows);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Products');
    sheet.addRow(['产品\nProduct', '产品族\nProduct Category', '更新时间\nUpdate Time']);
    sheet.addRow(['Optical', 'Network', '2026-10-03']);
    const excel = await products.parseImport(await workbook.xlsx.writeBuffer(), 'products.xlsx');
    assert.equal(excel[0].productName, 'Optical');
    assert.equal(excel[0].productCategory, 'Network');
    assert.equal(excel[0].updateTime, '2026-10-03');
    const tsv = await products.parseImport(Buffer.from('\uFEFF产品名称\t创建人\nRouter\tDragon'), 'products.tsv');
    assert.equal(tsv[0].creator, 'Dragon');
});

test('the visible CSV format examples can be imported in both languages', async () => {
    const html = fs.readFileSync(path.join(__dirname, '../backend/builtin-tools/tool-mumxi3px/index.html'), 'utf8');
    const chinese = html.match(/<pre[^>]*data-i18n="csvSample">([\s\S]*?)<\/pre>/)[1];
    const english = html.match(/csvSample:'([^']+)'/)[1].replace(/\\n/g, '\n');
    for (const sample of [chinese, english]) {
        const rows = await products.parseImport(Buffer.from(sample), 'example.csv');
        assert.equal(rows.length, 1);
        assert.equal(rows[0].productName, 'Router-A');
        assert.equal(rows[0].scenario, 'Installation');
        assert.equal(rows[0].updateTime, '2026-10-03');
    }
});

test('imports persist on server, reject non-admins and invalid input, and isolate tenants', async () => {
    await request(app).post(endpoint + '/import').set('x-role', 'user').attach('file', Buffer.from('[{"productName":"Unauthorized"}]'), 'products.json').expect(403);
    const data = [{ productName: 'Default-only', scenario: 'Scenario' }];
    await request(app).post(endpoint + '/import').attach('file', Buffer.from(JSON.stringify(data)), 'products.json').expect(200);
    await request(app).post(endpoint + '/import').attach('file', Buffer.from('Wrong Header\nInvalid'), 'bad.csv').expect(400);
    assert.equal((await request(app).get(endpoint).expect(200)).body.products[0].productName, 'Default-only');
    assert.deepEqual((await request(app).get(endpoint).set('x-tenant', 'other').expect(200)).body.products, []);
    await request(app).post(endpoint + '/import').set('x-tenant', 'other').attach('file', Buffer.from('[{"productName":"Other-only"}]'), 'products.json').expect(200);
    await db.closeDatabase();
    assert.equal((await request(app).get(endpoint).set('x-tenant', 'other').expect(200)).body.products[0].productName, 'Other-only');
    assert.equal((await request(app).get(endpoint).expect(200)).body.products[0].productName, 'Default-only');
});

test('both snapshot formats use latest server data for the requested tenant and escape script content', async () => {
    await runWithTenant('snapshot-a', () => products.saveProducts([{ productName: '</script><script>alert(1)</script>' }]));
    await runWithTenant('snapshot-b', () => products.saveProducts([{ productName: 'Tenant B' }]));
    const html = await snapshots.buildSnapshot('snapshot-a');
    for (const pattern of [/id="product-data-management"/, /id="import-products"/, /id="export-products"/, /id="product-file"/, /new FormData\(/, /URL\.createObjectURL\(/]) {
        assert.doesNotMatch(html, pattern);
    }
    assert.match(html, /__PRODUCT_SCOPE_SNAPSHOT__=true/);
    assert.match(html, /\\u003c\/script\\u003e/);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.doesNotMatch(html, /Tenant B/);
    const pages = await snapshots.buildPagesSnapshot('snapshot-b');
    assert.doesNotMatch(pages.html, /id="product-data-management"|id="import-products"|id="export-products"|new FormData\(|URL\.createObjectURL\(/);
    assert.match(pages.html, /__PRODUCT_SCOPE_DATA_URL__/);
    assert.equal(JSON.parse(pages.files.get('data/products.json'))[0].productName, 'Tenant B');
    await runWithTenant('snapshot-b', () => products.saveProducts([{ productName: 'New release' }]));
    assert.match(await snapshots.buildSnapshot('snapshot-b'), /New release/);
    const encrypted = await snapshots.buildSnapshot('snapshot-b', { encryption: { enabled: true, passwordHash: 'a'.repeat(64), passwordSalt: 'salt' } });
    assert.match(encrypted, /tpGatekeeperModal/);
});
