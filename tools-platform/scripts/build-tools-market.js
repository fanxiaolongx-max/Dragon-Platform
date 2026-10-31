#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { fingerprintFiles } = require('../backend/models/tool-content-fingerprint');

const projectRoot = path.resolve(__dirname, '..');
const sourceRoot = path.join(projectRoot, 'backend', 'builtin-tools');
const outputRoot = path.resolve(process.argv[2] || path.join(projectRoot, 'dist', 'tools-market'));
const packageRoot = path.join(outputRoot, 'packages');
const manifestName = '.tool-manifest.json';

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function listFiles(root, relative = '') {
    const result = [];
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
        const item = path.posix.join(relative.split(path.sep).join('/'), entry.name);
        if (entry.isSymbolicLink()) throw new Error(`Tool packages cannot contain symlinks: ${item}`);
        if (entry.isDirectory()) result.push(...listFiles(root, item));
        else if (entry.isFile()) result.push(item);
    }
    return result.sort();
}

function releaseVersion(tool) {
    if (String(tool.releaseVersion || '').trim()) {
        const value = String(tool.releaseVersion).trim();
        if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,39}$/.test(value)) throw new Error(`${tool.slug}: invalid releaseVersion`);
        return value;
    }
    const timestamp = Date.parse(tool.updatedAt);
    if (!Number.isFinite(timestamp)) throw new Error(`${tool.slug}: releaseVersion or a valid updatedAt is required`);
    return new Date(timestamp).toISOString().slice(0, 19).replace(/[-:T]/g, '.');
}

function validateManifest(slug, raw) {
    if (!raw || raw.version !== 1 || !raw.tool || raw.tool.slug !== slug) {
        throw new Error(`${slug}: invalid ${manifestName}`);
    }
    if (!raw.tool.name || !raw.tool.updatedAt) throw new Error(`${slug}: name and updatedAt are required`);
    return raw;
}

function signCatalog(catalog) {
    const privateKeyBase64 = String(process.env.TOOLS_MARKET_SIGNING_PRIVATE_KEY || '').trim();
    if (!privateKeyBase64) return catalog;
    const privateKey = crypto.createPrivateKey({
        key: Buffer.from(privateKeyBase64, 'base64'),
        format: 'der',
        type: 'pkcs8'
    });
    const payload = Buffer.from(JSON.stringify(catalog));
    return {
        ...catalog,
        signature: {
            algorithm: 'Ed25519',
            keyId: String(process.env.TOOLS_MARKET_SIGNING_KEY_ID || 'official-1'),
            value: crypto.sign(null, payload, privateKey).toString('base64')
        }
    };
}

async function main() {
    fs.rmSync(outputRoot, { recursive: true, force: true });
    fs.mkdirSync(packageRoot, { recursive: true });
    const slugs = fs.readdirSync(sourceRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && /^[a-z0-9][a-z0-9_-]{0,47}$/.test(entry.name))
        .map(entry => entry.name)
        .sort();
    const tools = [];
    for (const slug of slugs) {
        const toolRoot = path.join(sourceRoot, slug);
        const manifestPath = path.join(toolRoot, manifestName);
        if (!fs.existsSync(manifestPath)) continue;
        const manifest = validateManifest(slug, JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
        const files = listFiles(toolRoot);
        if (!files.includes('index.html')) throw new Error(`${slug}: index.html is required`);
        const zip = new JSZip();
        const stableDate = new Date(manifest.tool.updatedAt);
        const fileRecords = [];
        for (const file of files) {
            const content = fs.readFileSync(path.join(toolRoot, file));
            zip.file(file, content, { date: stableDate, createFolders: false });
            fileRecords.push({ path: file, size: content.length, sha256: sha256(content) });
        }
        const buffer = await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE',
            compressionOptions: { level: 9 },
            platform: 'UNIX'
        });
        const packageDigest = sha256(buffer);
        const version = releaseVersion(manifest.tool);
        const filename = `${slug}-${version}-${packageDigest.slice(0, 12)}.zip`;
        fs.writeFileSync(path.join(packageRoot, filename), buffer);
        tools.push({
            id: `official/${slug}`,
            slug,
            releaseVersion: version,
            releasedAt: manifest.tool.updatedAt,
            minPlatformVersion: String(manifest.tool.minPlatformVersion || '1.0.0'),
            changelog: String(manifest.tool.changelog || ''),
            tool: manifest.tool,
            package: {
                url: `packages/${filename}`,
                size: buffer.length,
                sha256: packageDigest,
                directoryFingerprint: fingerprintFiles(toolRoot, files),
                files: fileRecords
            }
        });
    }
    const unsignedCatalog = {
        catalogVersion: 1,
        publisher: 'tools-platform-official',
        generatedAt: new Date().toISOString(),
        platformVersion: require('../package.json').version,
        tools
    };
    const catalog = signCatalog(unsignedCatalog);
    fs.writeFileSync(path.join(outputRoot, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
    console.log(`Built ${tools.length} tool packages in ${path.relative(projectRoot, outputRoot)}`);
}

module.exports = { releaseVersion };

if (require.main === module) main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
