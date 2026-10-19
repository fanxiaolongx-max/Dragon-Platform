const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { assertFastStart } = require('./prepare-home-promo-videos');

const root = path.resolve(__dirname, '..');
const mediaDir = path.join(root, 'frontend/assets/promotions/datacom');
const catalogPath = path.join(mediaDir, 'manifest.json');
const manifestPath = path.join(root, 'backend/datacom-note-videos.json');
const chunkSize = 512 * 1024;
const releaseBase = 'https://github.com/fanxiaolongx-max/Dragon-Platform-Media/releases/download';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function buildManifest({ directory = mediaDir, catalog = JSON.parse(fs.readFileSync(catalogPath)), previous = {} } = {}) {
    const assets = {};
    const videos = {};
    for (const [id, meta] of Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b))) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || !/^\d{8}-[1-9]\d*$/.test(meta.v || '')) throw Error(`Invalid video id/version: ${id}`);
        if (!meta.title || !Number.isFinite(meta.duration) || meta.duration <= 0) throw Error(`Invalid video metadata: ${id}`);
        videos[id] = meta.v;
        const tag = `datacom-${id}-${meta.v}`;
        for (const suffix of ['', '-hd']) {
            const file = `${id}${suffix}.mp4`;
            const name = `datacom/${file}`;
            const url = `${releaseBase}/${tag}/${file}`;
            const local = path.join(directory, file);
            const old = previous.assets?.[name];
            if (!fs.existsSync(local)) {
                if (previous.videos?.[id] !== meta.v || old?.url !== url) throw Error(`Missing new video: ${file}; export both qualities first`);
                assets[name] = old;
                continue;
            }
            const bytes = fs.readFileSync(local);
            assertFastStart(bytes, file);
            const chunks = [];
            for (let i = 0; i < bytes.length; i += chunkSize) chunks.push(digest(bytes.subarray(i, i + chunkSize)));
            const asset = { size: bytes.length, sha256: digest(bytes), chunks, url };
            if (previous.videos?.[id] === meta.v && old && JSON.stringify(old) !== JSON.stringify(asset)) {
                throw Error(`Immutable video changed: ${file}; increment manifest.json v before publishing`);
            }
            assets[name] = asset;
        }
        if (!fs.existsSync(path.join(directory, `${id}-poster.jpg`))) throw Error(`Missing poster: ${id}`);
    }
    return { chunkSize, videos, assets };
}

function readSaved() { return fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath)) : {}; }
function checkManifest() {
    const saved = readSaved();
    const expected = buildManifest({ previous: saved });
    if (JSON.stringify(saved) !== JSON.stringify(expected)) throw Error('Datacom video manifest is stale; run npm run datacom:publish-videos before committing');
    return saved;
}
function writeManifest() {
    const manifest = buildManifest({ previous: readSaved() });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    return manifest;
}
if (require.main === module) {
    try {
        const manifest = process.argv.includes('--write') ? writeManifest() : checkManifest();
        console.log(`Datacom videos verified: ${Object.keys(manifest.videos).length} lessons, ${Object.keys(manifest.assets).length} MP4 files.`);
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { buildManifest, checkManifest, writeManifest, mediaDir, manifestPath, digest };
