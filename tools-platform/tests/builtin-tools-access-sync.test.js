const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builtin-access-test-'));
process.env.TOOLS_DATA_DIR = path.join(root, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(root, 'reports');
process.env.TOOLS_BUILTIN_TOOLS_DIR = path.join(root, 'source');

const sync = require('../backend/models/builtin-tools-sync');
const { initializeTenantBuiltinTools } = require('../backend/models/builtin-tools-startup');
const repo = require('../backend/models/custom-tools-repository');
const db = require('../backend/models/app-db');
const { runWithTenant, getDataDir } = require('../backend/models/tenant-context');

function write(dir, file, value) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), value);
}

function bundle(slug = 'sample', version = 'v1', date = '2026-10-20T00:00:00.000Z') {
    const dir = path.join(process.env.TOOLS_BUILTIN_TOOLS_DIR, slug);
    write(dir, 'index.html', `<p>${slug}-${version}</p>`);
    write(dir, '.tool-manifest.json', JSON.stringify({
        version: 1,
        tool: {
            slug,
            name: 'Sample Tool',
            icon: '🧩',
            description: 'Test description',
            publicAccess: false,
            updatedAt: date
        }
    }));
    return dir;
}

test.after(async () => {
    await db.closeDatabase();
    await require('../backend/models/tenant-sqlite-pool').closeAll();
    fs.rmSync(root, { recursive: true, force: true });
});

test('toggling publicAccess preserves builtIn metadata and leaves tool status unchanged without triggering diff modals', async () => {
    bundle('sample', 'v1');
    const tenant = 'test-tenant';
    const initResult = await initializeTenantBuiltinTools(tenant);
    assert.deepEqual(initResult.installed, ['sample']);

    await runWithTenant(tenant, async () => {
        const manifestPath = path.join(repo.getCustomToolsDir(), 'sample', '.tool-manifest.json');
        const manifestBefore = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        assert.equal(manifestBefore.builtIn, true);
        assert.ok(manifestBefore.system);
        assert.equal(manifestBefore.tool.publicAccess, false);

        // 1. Toggle publicAccess to true (allow anonymous access)
        const updatedTrue = await repo.updateToolAccess('sample', true);
        assert.equal(updatedTrue.publicAccess, true);

        const manifestAfterTrue = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        assert.equal(manifestAfterTrue.builtIn, true, 'builtIn should remain true');
        assert.ok(manifestAfterTrue.system, 'system marker should be preserved');
        assert.equal(manifestAfterTrue.tool.publicAccess, true);

        // Check preview: should be unchanged and NOT in pending
        let preview = sync.previewBuiltinTools({
            sourceDir: process.env.TOOLS_BUILTIN_TOOLS_DIR,
            targetDir: repo.getCustomToolsDir()
        });
        assert.ok(preview.unchanged.includes('sample'), 'sample should be unchanged');
        assert.equal(preview.pending.some(p => p.slug === 'sample'), false, 'sample must not be pending');

        // 2. Toggle publicAccess back to false (require login)
        const updatedFalse = await repo.updateToolAccess('sample', false);
        assert.equal(updatedFalse.publicAccess, false);

        const manifestAfterFalse = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        assert.equal(manifestAfterFalse.builtIn, true, 'builtIn should remain true');
        assert.ok(manifestAfterFalse.system, 'system marker should be preserved');
        assert.equal(manifestAfterFalse.tool.publicAccess, false);

        preview = sync.previewBuiltinTools({
            sourceDir: process.env.TOOLS_BUILTIN_TOOLS_DIR,
            targetDir: repo.getCustomToolsDir()
        });
        assert.ok(preview.unchanged.includes('sample'), 'sample should be unchanged');
        assert.equal(preview.pending.some(p => p.slug === 'sample'), false, 'sample must not be pending');
    });
});
