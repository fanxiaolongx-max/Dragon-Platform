#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function stampToolRelease(slug, { sourceRoot = path.resolve(__dirname, '../backend/builtin-tools'), now = new Date() } = {}) {
    if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(slug || '')) throw new Error('A valid tool slug is required');
    const target = path.join(sourceRoot, slug, '.tool-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (manifest.version !== 1 || manifest.tool?.slug !== slug) throw new Error('Invalid tool manifest');
    // Record release time once in source, so local bundles and market builds agree.
    manifest.tool.updatedAt = now.toISOString();
    fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest.tool.updatedAt;
}

module.exports = { stampToolRelease };

if (require.main === module) {
    try {
        if (process.argv.length !== 3) throw new Error('Usage: npm run tools:release:stamp -- <tool-slug>');
        console.log(`${process.argv[2]}: ${stampToolRelease(process.argv[2])}`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
