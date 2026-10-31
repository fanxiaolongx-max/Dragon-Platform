'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compareCatalogTool } = require('../backend/models/custom-tools-market-service');
const { fingerprintFiles } = require('../backend/models/tool-content-fingerprint');

test('market compares release content despite stale inventories and extra local assets', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'market-content-'));
    try {
        const sourceDir = path.join(root, 'source');
        const targetDir = path.join(root, 'target');
        const slug = 'sample';
        const source = path.join(sourceDir, slug);
        const target = path.join(targetDir, slug);
        fs.mkdirSync(source, { recursive: true });
        fs.mkdirSync(target, { recursive: true });
        const manifest = { version: 1, tool: { slug, name: 'Sample', updatedAt: '2026-09-05T00:00:00.000Z' } };
        fs.writeFileSync(path.join(source, '.tool-manifest.json'), JSON.stringify(manifest));
        fs.writeFileSync(path.join(source, 'index.html'), '<p>sample</p>\n');
        fs.writeFileSync(path.join(source, '.i18n.json'), '{"hello":"你好"}');
        const files = ['.tool-manifest.json', 'index.html', '.i18n.json'];
        const item = { id: 'official/sample', slug, tool: manifest.tool, releasedAt: manifest.tool.updatedAt,
            releaseVersion: '2026.09.05', minPlatformVersion: '1.0.0',
            package: { directoryFingerprint: fingerprintFiles(source, files), files: files.map(file => ({ path: file })) } };
        for (const file of files) fs.copyFileSync(path.join(source, file), path.join(target, file));
        const installed = { ...manifest, system: { managedBy: 'tools-platform', fingerprint: 'stale', files: ['index.html'] } };
        fs.writeFileSync(path.join(target, '.tool-manifest.json'), JSON.stringify(installed));
        const compare = () => compareCatalogTool(item, { sourceDir, targetDir });
        assert.equal(compare().localUpdatedAt, installed.tool.updatedAt);
        assert.equal(compare().marketUpdatedAt, item.releasedAt);
        assert.equal(compare().status, 'unchanged');
        assert.equal(compare().selectedSource, 'market');
        // Generated audio retained locally is outside the market release inventory.
        fs.writeFileSync(path.join(source, 'extra.mp3'), Buffer.from([0, 1, 2]));
        fs.writeFileSync(path.join(target, 'extra.mp3'), Buffer.from([0, 1, 2]));
        installed.system.files.push('extra.mp3');
        fs.writeFileSync(path.join(target, '.tool-manifest.json'), JSON.stringify(installed));
        assert.equal(compare().status, 'unchanged');
        fs.writeFileSync(path.join(target, '.i18n.json'), '{}');
        assert.equal(compare().status, 'update');
        fs.unlinkSync(path.join(target, '.i18n.json'));
        assert.equal(compare().status, 'update');
        fs.copyFileSync(path.join(source, '.i18n.json'), path.join(target, '.i18n.json'));
        // Market-installed tools must also inspect files rather than trust metadata.
        installed.market = { id: item.id, releaseVersion: item.releaseVersion };
        installed.system.fingerprint = item.package.directoryFingerprint;
        fs.writeFileSync(path.join(target, '.tool-manifest.json'), JSON.stringify(installed));
        assert.equal(compare().status, 'unchanged');
        fs.writeFileSync(path.join(target, 'index.html'), 'modified');
        assert.equal(compare().status, 'update');
        installed.market.releasedAt = '2026-09-05T09:10:11.123Z';
        installed.market.installedAt = '2026-09-07T23:59:59.000Z';
        fs.writeFileSync(path.join(target, '.tool-manifest.json'), JSON.stringify(installed));
        assert.equal(compare().localUpdatedAt, installed.market.releasedAt);
        assert.equal(compare().selectedSource, 'market');
        // A newer bundled release on the same day must use its full inventory, including new assets.
        manifest.tool.updatedAt = '2026-09-05T18:30:45.123Z';
        fs.writeFileSync(path.join(source, '.tool-manifest.json'), JSON.stringify(manifest));
        assert.equal(compare().selectedSource, 'builtin');
        assert.equal(compare().status, 'update');
        for (const file of [...files, 'extra.mp3']) fs.copyFileSync(path.join(source, file), path.join(target, file));
        installed.tool = manifest.tool;
        fs.writeFileSync(path.join(target, '.tool-manifest.json'), JSON.stringify(installed));
        assert.equal(compare().status, 'unchanged');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
