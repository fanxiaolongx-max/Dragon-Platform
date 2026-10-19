#!/usr/bin/env node

/**
 * sync-media-releases.js
 *
 * Automatically inspects `tools-platform/backend/home-promo-videos.json`
 * and checks whether all required release tags exist on `fanxiaolongx-max/Dragon-Platform-Media`.
 * If any release tag is missing on GitHub Releases, it creates the release and
 * uploads the required .mp4 video files and manifest using GitHub CLI (`gh`).
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_MEDIA = 'fanxiaolongx-max/Dragon-Platform-Media';
const projectRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(projectRoot, '..');
const manifestPath = path.join(projectRoot, 'backend/home-promo-videos.json');
const promotionsDir = path.join(projectRoot, 'frontend/assets/promotions');

function runGh(args) {
    try {
        return execFileSync('gh', args, {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        }).trim();
    } catch (error) {
        const stderr = error.stderr ? error.stderr.toString().trim() : '';
        const msg = stderr || error.message;
        throw new Error(`[gh ${args.join(' ')}] failed: ${msg}`);
    }
}

function getExistingReleases() {
    const raw = runGh(['release', 'list', '--repo', REPO_MEDIA, '--limit', '100']);
    const tags = new Set();
    for (const line of raw.split('\n')) {
        const parts = line.split('\t').map(s => s.trim()).filter(Boolean);
        // `gh release list` tab-separated or column-formatted output:
        // usually TITLE \t TYPE \t TAG NAME \t PUBLISHED
        // or contains tag as part
        const matches = line.match(/\b([a-z0-9-]+-202[0-9]{5})\b/i);
        if (matches) {
            tags.add(matches[1]);
        }
    }
    return tags;
}

function parseRequiredReleases() {
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`Manifest not found at ${manifestPath}`);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const releases = new Map(); // tag -> Set of filenames

    for (const [name, meta] of Object.entries(manifest.assets || {})) {
        const url = meta.url || `${manifest.baseUrl}/${name}`;
        const match = url.match(/releases\/download\/([^/]+)\//);
        if (match) {
            const tag = match[1];
            if (!releases.has(tag)) {
                releases.set(tag, new Set());
            }
            releases.get(tag).add(name);
        }
    }
    return releases;
}

function sync() {
    console.log(`[sync-media] Checking remote releases on ${REPO_MEDIA}...`);
    const existingTags = getExistingReleases();
    const requiredReleases = parseRequiredReleases();

    let publishedCount = 0;

    for (const [tag, files] of requiredReleases.entries()) {
        if (existingTags.has(tag)) {
            continue;
        }

        console.log(`\n[sync-media] Found missing release tag: ${tag}`);
        const assetPaths = [];

        for (const filename of files) {
            const filePath = path.join(promotionsDir, filename);
            if (!fs.existsSync(filePath)) {
                throw new Error(`[sync-media] Required video file missing locally: ${filePath}`);
            }
            assetPaths.push(filePath);
            console.log(`  + Video asset: ${filename} (${(fs.statSync(filePath).size / 1024 / 1024).toFixed(1)} MB)`);
        }

        // Also attach home-promo-videos.json
        assetPaths.push(manifestPath);
        console.log(`  + Manifest: home-promo-videos.json`);

        const title = `Media release · ${tag}`;
        const notes = `Automated media release for promo videos (${Array.from(files).join(', ')}).`;

        console.log(`[sync-media] Creating release ${tag} on ${REPO_MEDIA}...`);
        runGh([
            'release', 'create', tag,
            ...assetPaths,
            '--repo', REPO_MEDIA,
            '--title', title,
            '--notes', notes
        ]);

        console.log(`[sync-media] ✓ Successfully published ${tag} to ${REPO_MEDIA}`);
        publishedCount++;
    }

    if (publishedCount === 0) {
        console.log(`[sync-media] ✓ All ${requiredReleases.size} promo video release(s) are up-to-date on ${REPO_MEDIA}.`);
    } else {
        console.log(`[sync-media] ✓ Successfully synced ${publishedCount} new media release(s).`);
    }
}

try {
    sync();
} catch (error) {
    console.error(`[sync-media] Error: ${error.message}`);
    process.exit(1);
}
