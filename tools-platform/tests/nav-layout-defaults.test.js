const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const repo = require('../backend/models/nav-settings-repository');
const { runWithTenant } = require('../backend/models/tenant-context');
const appDb = require('../backend/models/app-db');
const pool = require('../backend/models/tenant-sqlite-pool');

test('nav-layout-defaults: getDefaultNavLayout reads from defaults/nav-layout.json', async t => {
    const defaultLayout = repo.getDefaultNavLayout();
    assert.ok(Array.isArray(defaultLayout.primaryIds));
    assert.ok(defaultLayout.primaryIds.includes('topic-analysis'));
    assert.ok(Array.isArray(defaultLayout.categories));
    assert.ok(defaultLayout.categories.some(c => c.id === 'cat_mu9po0me'));
    assert.equal(typeof defaultLayout.categoryByItem, 'object');
    assert.ok(Array.isArray(defaultLayout.itemOrder));
});

test('nav-layout-defaults: DEFAULT_SETTINGS dynamically delegates to getDefaultNavLayout', async () => {
    const layout = repo.getDefaultNavLayout();
    assert.deepEqual(repo.DEFAULT_SETTINGS.primaryIds, layout.primaryIds);
    assert.deepEqual(repo.DEFAULT_SETTINGS.categories, layout.categories);
    assert.deepEqual(repo.DEFAULT_SETTINGS.categoryByItem, layout.categoryByItem);
    assert.deepEqual(repo.DEFAULT_SETTINGS.itemOrder, layout.itemOrder);
});

test('nav-layout-defaults: setAsDefaultLayout writes defaults/nav-layout.json and saves to current tenant', async t => {
    const defaultsFile = path.join(__dirname, '../backend/defaults/nav-layout.json');
    const originalContent = fs.readFileSync(defaultsFile, 'utf8');

    t.after(async () => {
        // Restore original file
        fs.writeFileSync(defaultsFile, originalContent, 'utf8');
        await appDb.closeDatabase();
        await pool.closeAll();
    });

    const customLayout = {
        primaryIds: ['home', 'topic-analysis', 'custom-report'],
        categories: [
            { id: 'audit', name: '审计与核算', nameEn: 'Audit & KPI' },
            { id: 'custom_cat_test', name: '测试分类', nameEn: 'Test Cat' }
        ],
        categoryByItem: {
            'frt': 'audit',
            'custom:test-item': 'custom_cat_test'
        },
        itemOrder: ['frt', 'custom:test-item']
    };

    const result = await repo.setAsDefaultLayout(customLayout);
    assert.equal(result.success, true);
    assert.equal(result.file, 'backend/defaults/nav-layout.json');
    assert.deepEqual(result.layout.primaryIds, customLayout.primaryIds);

    // Verify written file
    const fileContent = JSON.parse(fs.readFileSync(defaultsFile, 'utf8'));
    assert.deepEqual(fileContent.primaryIds, customLayout.primaryIds);
    assert.deepEqual(fileContent.categories, customLayout.categories);
    assert.deepEqual(fileContent.categoryByItem, customLayout.categoryByItem);
    assert.deepEqual(fileContent.itemOrder, customLayout.itemOrder);

    // Verify current tenant settings updated
    const currentSettings = await repo.getSettings();
    assert.deepEqual(currentSettings.primaryIds, customLayout.primaryIds);
    assert.deepEqual(currentSettings.categories, customLayout.categories);

    // Verify restoreDefaultsPreservingCustomTools now restores to the new defaults
    const restored = await repo.restoreDefaultsPreservingCustomTools([]);
    assert.deepEqual(restored.settings.primaryIds, customLayout.primaryIds);
});

test('nav-layout-defaults: frontend navbar.js and shared.css contain set-as-default bindings', () => {
    const navbarJs = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/navbar.js'), 'utf8');
    const sharedCss = fs.readFileSync(path.join(__dirname, '../frontend/css/shared.css'), 'utf8');

    // UI elements
    assert.match(navbarJs, /setCurrentNavigationAsDefault/);
    assert.match(navbarJs, /nav-settings-btn-setdefault/);
    assert.match(navbarJs, /\/api\/nav-settings\/set-as-default/);
    assert.match(navbarJs, /nav\.set\.default\.button/);
    assert.match(navbarJs, /设为系统默认布局/);
    assert.match(navbarJs, /Set as system default/);

    // CSS
    assert.match(sharedCss, /\.nav-settings-restore-actions/);
    assert.match(sharedCss, /\.nav-settings-btn-setdefault/);
});

test('nav-layout-defaults: POST /api/nav-settings/set-as-default requires admin and saves layout', async t => {
    const express = require('express');
    const request = require('supertest');
    const navRouter = require('../backend/routes/nav-settings');
    const defaultsFile = path.join(__dirname, '../backend/defaults/nav-layout.json');
    const originalContent = fs.readFileSync(defaultsFile, 'utf8');

    t.after(() => {
        fs.writeFileSync(defaultsFile, originalContent, 'utf8');
    });

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        const role = req.headers['x-test-role'];
        if (role) {
            req.user = { id: 1, username: 'tester', role };
        }
        next();
    });
    app.use('/api/nav-settings', navRouter);

    // 1. Non-admin request should be rejected with 403
    const resForbidden = await request(app)
        .post('/api/nav-settings/set-as-default')
        .set('x-test-role', 'viewer')
        .send({ settings: { primaryIds: ['home'] } });
    assert.equal(resForbidden.status, 403);

    // 2. Admin request succeeds and updates default layout
    const resAdmin = await request(app)
        .post('/api/nav-settings/set-as-default')
        .set('x-test-role', 'admin')
        .send({
            settings: {
                primaryIds: ['home', 'sla'],
                categories: [{ id: 'audit', name: '审计与核算' }],
                categoryByItem: { frt: 'audit' },
                itemOrder: ['frt']
            }
        });
    assert.equal(resAdmin.status, 200);
    assert.equal(resAdmin.body.success, true);
    assert.deepEqual(resAdmin.body.layout.primaryIds, ['home', 'sla']);

    const diskContent = JSON.parse(fs.readFileSync(defaultsFile, 'utf8'));
    assert.deepEqual(diskContent.primaryIds, ['home', 'sla']);
});
