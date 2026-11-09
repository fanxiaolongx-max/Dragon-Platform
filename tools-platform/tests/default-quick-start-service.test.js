const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const service = require('../backend/models/default-quick-start-service');
const { closeDatabase } = require('../backend/models/app-db');

test.after(() => closeDatabase());

function makeFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-quick-start-'));
    const bundlePath = path.join(root, 'bundle.json');
    const statePath = path.join(root, 'state.json');
    const backupDir = path.join(root, 'backups');
    const bundle = {
        schemaVersion: 1,
        bundleVersion: 'test-1',
        generatedAt: '2026-08-14T00:00:00.000Z',
        description: 'test',
        mergePolicy: 'preserve-existing',
        summary: { scriptCount: 2, targetCount: 2 },
        uiv: {
            categories: ['Default', 'Bundled'],
            scripts: [
                { id: 'same-id', name: 'Existing script', category: 'Default' },
                { id: 'new-id', name: 'New script', category: 'Bundled' }
            ]
        },
        sla: {
            categories: ['TE', 'ORG'],
            targets: { same: { weight: 1 }, added: { weight: 2 } },
            prefs: { samePref: { value: 'bundle' }, addedPref: { value: 'bundle' } },
            groups: [
                { id: 'same-group', name: 'Same', metrics: ['bundle'] },
                { id: 'new-group', name: 'New', metrics: ['added'] }
            ]
        }
    };
    fs.writeFileSync(bundlePath, JSON.stringify(bundle), 'utf8');

    const data = {
        scripts: [{ id: 'same-id', name: 'Existing script', category: 'User', marker: 'keep' }],
        uivCategories: ['Default', 'User'],
        targets: { same: { weight: 99, marker: 'keep' } },
        prefs: { samePref: { value: 'user' } },
        groups: [{ id: 'same-group', name: 'Same', metrics: ['user'] }],
        slaCategories: ['TE', 'VDF']
    };
    const clone = value => JSON.parse(JSON.stringify(value));
    const repositories = {
        scriptsRepo: {
            listScripts: async () => ({ items: clone(data.scripts), source: 'test' }),
            replaceAllScripts: async value => { data.scripts = clone(value); }
        },
        uivCategoriesRepo: {
            listCategories: async () => ({ items: clone(data.uivCategories), source: 'test' }),
            replaceCategories: async value => { data.uivCategories = clone(value); }
        },
        targetsRepo: {
            getTargets: async () => ({ items: clone(data.targets), source: 'test' }),
            replaceTargets: async value => { data.targets = clone(value); }
        },
        prefsRepo: {
            getPrefsObject: async () => ({ items: clone(data.prefs), source: 'test' }),
            replacePrefs: async value => { data.prefs = clone(value); }
        },
        groupsRepo: {
            listGroups: async () => ({ items: clone(data.groups), source: 'test' }),
            replaceGroups: async value => { data.groups = clone(value); }
        },
        slaCategoriesRepo: {
            listCategories: async () => ({ items: clone(data.slaCategories), source: 'test' }),
            replaceCategories: async value => { data.slaCategories = clone(value); }
        }
    };
    return { root, bundlePath, statePath, backupDir, data, repositories };
}

test('first-run import adds missing defaults and preserves existing values', async t => {
    const fixture = makeFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

    const before = await service.getStatus({
        role: 'admin', bundlePath: fixture.bundlePath, statePath: fixture.statePath
    });
    assert.equal(before.required, true);

    const state = await service.applyDecision({
        action: 'import',
        importScripts: true,
        importMetricRules: true,
        actor: 'admin',
        bundlePath: fixture.bundlePath,
        statePath: fixture.statePath,
        backupDir: fixture.backupDir,
        repositories: fixture.repositories
    });

    assert.equal(state.decision, 'import');
    assert.deepEqual(state.imported, { scripts: true, metricRules: true });
    assert.equal(state.result.scriptsAdded, 1);
    assert.equal(state.result.targetsAdded, 1);
    assert.equal(state.result.preferencesAdded, 1);
    assert.equal(state.result.groupsAdded, 1);
    assert.equal(fixture.data.scripts.find(item => item.id === 'same-id').marker, 'keep');
    assert(fixture.data.scripts.some(item => item.id === 'new-id'));
    assert.equal(fixture.data.targets.same.weight, 99);
    assert.equal(fixture.data.targets.added.weight, 2);
    assert.equal(fixture.data.prefs.samePref.value, 'user');
    assert.deepEqual(fixture.data.groups[0].metrics, ['user']);
    assert.deepEqual(fixture.data.slaCategories, ['TE', 'VDF', 'ORG']);
    assert.equal(fs.readdirSync(fixture.backupDir).length, 1);

    const after = await service.getStatus({
        role: 'admin', bundlePath: fixture.bundlePath, statePath: fixture.statePath
    });
    assert.equal(after.required, false);
    assert.equal(after.state.decision, 'import');

    await assert.rejects(() => service.applyDecision({
        action: 'skip',
        bundlePath: fixture.bundlePath,
        statePath: fixture.statePath,
        repositories: fixture.repositories
    }), error => error.statusCode === 409);
});

test('skip records the choice without changing repositories', async t => {
    const fixture = makeFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const before = JSON.stringify(fixture.data);

    const state = await service.applyDecision({
        action: 'skip',
        actor: 'admin',
        bundlePath: fixture.bundlePath,
        statePath: fixture.statePath,
        backupDir: fixture.backupDir,
        repositories: fixture.repositories
    });

    assert.equal(state.decision, 'skip');
    assert.equal(JSON.stringify(fixture.data), before);
    assert.equal(fs.existsSync(fixture.backupDir), false);
});

test('global settings can safely reapply bundled defaults after first-run decision', async t => {
    const fixture = makeFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

    await service.applyDecision({
        action: 'skip',
        actor: 'admin',
        bundlePath: fixture.bundlePath,
        statePath: fixture.statePath,
        backupDir: fixture.backupDir,
        repositories: fixture.repositories
    });
    const state = await service.applyBundledDefaults({
        importScripts: true,
        importMetricRules: true,
        actor: 'admin',
        bundlePath: fixture.bundlePath,
        statePath: fixture.statePath,
        backupDir: fixture.backupDir,
        repositories: fixture.repositories
    });

    assert.equal(state.decision, 'import');
    assert.equal(state.result.scriptsAdded, 1);
    assert.equal(fixture.data.targets.same.weight, 99);
    assert(fixture.data.scripts.some(item => item.id === 'new-id'));

    const imported = structuredClone(fixture.data);
    const repeated = await service.applyBundledDefaults({
        importScripts: true,
        importMetricRules: true,
        bundlePath: fixture.bundlePath,
        statePath: fixture.statePath,
        backupDir: fixture.backupDir,
        repositories: fixture.repositories
    });
    assert.deepEqual(repeated.result, {
        scriptsAdded: 0,
        scriptsPreserved: 2,
        targetsAdded: 0,
        preferencesAdded: 0,
        groupsAdded: 0,
        categoriesAdded: 0
    });
    assert.deepEqual(fixture.data, imported);
});

test('non-admin status never requests a global import decision', async t => {
    const fixture = makeFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const status = await service.getStatus({
        role: 'user', bundlePath: fixture.bundlePath, statePath: fixture.statePath
    });
    assert.equal(status.required, false);
    assert.equal(status.requiresAdmin, true);
});

test('a failed import restores the pre-import configuration and leaves the decision pending', async t => {
    const fixture = makeFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const before = JSON.stringify(fixture.data);
    const originalReplace = fixture.repositories.slaCategoriesRepo.replaceCategories;
    let shouldFail = true;
    fixture.repositories.slaCategoriesRepo.replaceCategories = async value => {
        if (shouldFail) {
            shouldFail = false;
            throw new Error('simulated write failure');
        }
        return originalReplace(value);
    };

    await assert.rejects(() => service.applyDecision({
        action: 'import',
        importScripts: true,
        importMetricRules: true,
        bundlePath: fixture.bundlePath,
        statePath: fixture.statePath,
        backupDir: fixture.backupDir,
        repositories: fixture.repositories
    }), /simulated write failure/);

    assert.equal(JSON.stringify(fixture.data), before);
    assert.equal(fs.existsSync(fixture.statePath), false);
});

test('getStatus returns build version, builtAt, platform, and third-party dependencies', async t => {
    const fixture = makeFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const status = await service.getStatus({
        role: 'admin', bundlePath: fixture.bundlePath, statePath: fixture.statePath
    });
    assert.ok(status.build);
    assert.ok(status.build.version);
    assert.ok(status.build.builtAt);
    assert.ok(status.build.platformLabel);
    assert.ok(Array.isArray(status.build.dependencies));
    assert.ok(status.build.dependencies.length >= 7);
    const excelDep = status.build.dependencies.find(d => d.name === 'exceljs');
    assert.ok(excelDep);
    assert.ok(excelDep.version);
    assert.ok(excelDep.role);
});
