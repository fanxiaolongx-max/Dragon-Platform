const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const projectRoot = path.resolve(__dirname, '..');
const offlinePackagePath = path.join(
    projectRoot,
    'frontend',
    'downloads',
    'uivision-extension-9.6.1.zip'
);
const captureToolRoot = path.join(
    projectRoot,
    'backend',
    'builtin-tools',
    'f12-to-extension'
);
const captureTemplatePath = path.join(captureToolRoot, 'chrome-capture-pro.template.zip');
const arabicAudioBundlePath = path.join(
    projectRoot,
    'backend',
    'builtin-tools',
    'tool-mtakhxqm',
    'audio',
    'audio.bundle.zip'
);
const captureBundlePaths = [
    'aviftest/bundle.js',
    'editor/bundle.js',
    'options/bundle.js',
    'popup/bundle.js'
].map(relativePath => path.join(captureToolRoot, 'chrome-capture-pro', 'dist', relativePath));
const googleApiKeyPattern = /AIza[0-9A-Za-z_-]{20,}/;

function assertReleaseFile(filePath, minimumBytes = 1) {
    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch (_error) {
        throw new Error(`Required release asset is missing: ${path.relative(projectRoot, filePath)}`);
    }
    if (!stat.isFile() || stat.size < minimumBytes) {
        throw new Error(`Required release asset is invalid: ${path.relative(projectRoot, filePath)}`);
    }
}

async function loadZip(filePath) {
    assertReleaseFile(filePath, 4);
    try {
        return await JSZip.loadAsync(fs.readFileSync(filePath));
    } catch (_error) {
        throw new Error(`Release asset is not a readable ZIP: ${path.relative(projectRoot, filePath)}`);
    }
}

async function assertZipHasFiles(filePath) {
    const archive = await loadZip(filePath);
    const files = Object.values(archive.files).filter(entry => !entry.dir);
    if (files.length === 0) {
        throw new Error(`Release ZIP contains no files: ${path.relative(projectRoot, filePath)}`);
    }
}

function assertBundlesContainNoGoogleApiKeys() {
    const affected = captureBundlePaths.filter(filePath => {
        assertReleaseFile(filePath);
        return googleApiKeyPattern.test(fs.readFileSync(filePath, 'utf8'));
    });
    if (affected.length > 0) {
        throw new Error(`Google API key detected in release bundles: ${affected.map(filePath => path.relative(projectRoot, filePath)).join(', ')}`);
    }
}

async function assertTemplateContainsNoGoogleApiKeys() {
    const archive = await loadZip(captureTemplatePath);
    const affected = [];
    for (const entry of Object.values(archive.files)) {
        if (entry.dir || !entry.name.endsWith('.js')) continue;
        const content = await entry.async('string');
        if (googleApiKeyPattern.test(content)) affected.push(entry.name);
    }
    if (affected.length > 0) {
        throw new Error(`Google API key detected in Chrome Capture Pro template entries: ${affected.join(', ')}`);
    }
}

async function main() {
    require('./prepare-gallery-examples').checkManifest();
    require('./prepare-home-promo-videos').checkManifest();
    require('./prepare-datacom-videos').checkManifest();
    assertReleaseFile(path.join(projectRoot,'backend/builtin-templates/monthly-report.json'));
    const monthlyTemplate=await require('../backend/models/monthly-template-repository').readBundled();
    const monthlyLogo=monthlyTemplate.document.logo;
    if(monthlyLogo&&!monthlyLogo.startsWith('/assets/'))throw new Error('Bundled monthly template logo must be included in frontend assets.');
    if(monthlyLogo)assertReleaseFile(path.join(projectRoot,'frontend',monthlyLogo.slice(1)));
    await assertZipHasFiles(offlinePackagePath);
    await assertZipHasFiles(arabicAudioBundlePath);
    assertBundlesContainNoGoogleApiKeys();
    await assertTemplateContainsNoGoogleApiKeys();
    console.log('Release assets verified.');
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
