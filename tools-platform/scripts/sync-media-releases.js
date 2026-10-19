#!/usr/bin/env node
// Publish immutable public product media separately from the application repository.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { checkManifest: checkDatacom, mediaDir, manifestPath, digest } = require('./prepare-datacom-videos');
const { checkManifest: checkHome } = require('./prepare-home-promo-videos');
const REPO_MEDIA = 'fanxiaolongx-max/Dragon-Platform-Media';
const root = path.resolve(__dirname, '..');

function gh(args, binary = false) {
    return execFileSync('gh', args, { cwd: root, encoding: binary ? undefined : 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024 });
}
function release(tag) {
    try { return JSON.parse(gh(['api', `repos/${REPO_MEDIA}/releases/tags/${encodeURIComponent(tag)}`])); }
    catch (error) {
        if (String(error.stderr).includes('HTTP 404')) {
            // The tag API does not resolve unpublished drafts. gh can locate their database ID.
            let id;
            try { id = JSON.parse(gh(['release', 'view', tag, '--repo', REPO_MEDIA, '--json', 'databaseId'])).databaseId; }
            catch (lookup) { if (/release not found|HTTP 404/i.test(String(lookup.stderr))) return null; throw lookup; }
            return JSON.parse(gh(['api', `repos/${REPO_MEDIA}/releases/${id}`]));
        }
        throw error;
    }
}
function planReleases(catalogs) {
    const groups = new Map();
    for (const { catalog, directory, manifest } of catalogs) {
        for (const [key, meta] of Object.entries(catalog.assets)) {
            const url = new URL(meta.url || `${catalog.baseUrl}/${key}`);
            const prefix = `/${REPO_MEDIA}/releases/download/`;
            if (url.origin !== 'https://github.com' || !url.pathname.startsWith(prefix)) throw Error(`Invalid media repository: ${key}`);
            const parts = url.pathname.slice(prefix.length).split('/');
            if (parts.length !== 2 || !/^[a-z0-9-]+$/.test(parts[0]) || !/^[a-z0-9-]+\.mp4$/.test(parts[1])) throw Error(`Invalid media release path: ${key}`);
            const [tag, file] = parts;
            if (!groups.has(tag)) groups.set(tag, { tag, manifests: new Set(), assets: [] });
            const group = groups.get(tag);
            if (group.assets.some(item => item.file === file)) throw Error(`Duplicate media asset: ${tag}/${file}`);
            group.assets.push({ file, meta, local: path.join(directory, key.replace(/^datacom\//, '')) });
            group.manifests.add(manifest);
        }
    }
    return [...groups.values()];
}
function verifyAsset(tag, expected, actual) {
    if (!actual || actual.state !== 'uploaded' || actual.size !== expected.meta.size) throw Error(`Missing/incomplete media asset: ${tag}/${expected.file}`);
    let hash = actual.digest;
    if (!hash) {
        hash = `sha256:${digest(gh(['release', 'download', tag, '--repo', REPO_MEDIA, '--pattern', expected.file, '--output', '-'], true))}`;
    }
    if (hash !== `sha256:${expected.meta.sha256}`) throw Error(`Remote checksum mismatch: ${tag}/${expected.file}; publish a NEW version, never overwrite`);
}
function sync({ check = false, datacomOnly = false } = {}) {
    const catalogs = [{ catalog: checkDatacom(), directory: mediaDir, manifest: manifestPath }];
    if (!datacomOnly) catalogs.unshift({ catalog: checkHome(), directory: path.join(root, 'frontend/assets/promotions'), manifest: path.join(root, 'backend/home-promo-videos.json') });
    const groups = planReleases(catalogs);
    for (const group of groups) {
        let remote = release(group.tag);
        const missing = group.assets.filter(item => !remote?.assets.some(asset => asset.name === item.file));
        // Validate every existing asset even when its release tag already exists.
        for (const item of group.assets.filter(item => !missing.includes(item))) verifyAsset(group.tag, item, remote.assets.find(asset => asset.name === item.file));
        if (check && (!remote || remote.draft || missing.length)) throw Error(`Media not published: ${group.tag}; run npm run datacom:publish-videos locally before pushing`);
        if (missing.length) {
            for (const item of missing) {
                if (!fs.existsSync(item.local) || digest(fs.readFileSync(item.local)) !== item.meta.sha256) throw Error(`Missing/changed local asset: ${item.local}`);
            }
            if (!remote) {
                gh(['release', 'create', group.tag, '--repo', REPO_MEDIA, '--draft', '--title', `Media · ${group.tag}`, '--notes', 'Immutable public product videos. Application code and private data are excluded.']);
            }
            gh(['release', 'upload', group.tag, ...missing.map(item => item.local), '--repo', REPO_MEDIA]);
            remote = release(group.tag);
        }
        if (remote?.draft && !check) {
            const attachments = [...group.manifests].filter(file => !remote.assets.some(asset => asset.name === path.basename(file)));
            if (attachments.length) gh(['release', 'upload', group.tag, ...attachments, '--repo', REPO_MEDIA]);
            for (const item of group.assets) verifyAsset(group.tag, item, remote.assets.find(asset => asset.name === item.file));
            gh(['release', 'edit', group.tag, '--repo', REPO_MEDIA, '--draft=false', '--latest=false']);
            remote = release(group.tag);
        }
        for (const item of group.assets) verifyAsset(group.tag, item, remote.assets.find(asset => asset.name === item.file));
        console.log(`[sync-media] Verified ${group.tag}: ${group.assets.length} files (size + SHA-256).`);
    }
}
if (require.main === module) {
    try { sync({ check: process.argv.includes('--check'), datacomOnly: process.argv.includes('--datacom') }); }
    catch (error) { console.error(`[sync-media] ${error.stderr?.toString().trim() || error.message}`); process.exitCode = 1; }
}
module.exports = { planReleases, verifyAsset, sync };
