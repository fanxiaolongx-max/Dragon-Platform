const path = require('path');
const { execFileSync } = require('child_process');
const { writePageUpdatesManifest } = require('../backend/models/page-update-times');

const projectRoot = path.resolve(__dirname, '..');
const frontendDir = path.join(projectRoot, 'frontend');
const outPath = path.join(frontendDir, 'assets', 'page-updates.json');

async function main() {
    try {
        const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
            cwd: frontendDir,
            encoding: 'utf8'
        }).trim();
        if (shallow === 'true') {
            console.warn('[page-updates] Warning: shallow git repository detected; page update times may reflect only fetched commits.');
        }
    } catch {
        // Ignore when running outside git.
    }
    const times = await writePageUpdatesManifest(frontendDir, outPath);
    console.log(`[page-updates] Generated ${path.relative(projectRoot, outPath)} (${Object.keys(times).length} pages).`);
}

main().catch(error => {
    console.error(`[page-updates] Failed: ${error.message}`);
    process.exitCode = 1;
});
